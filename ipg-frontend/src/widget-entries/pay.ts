/*!
 * Native-mount entry for the payment widget — compiled by
 * `npm run build:widget:pay` into sdk/js/pay-widget.js. Mounts
 * WidgetPayPanel.vue directly into the host page via a Vue Custom Element
 * (its own Shadow DOM, no iframe). See sdk/js/README.md for the
 * merchant-facing integration contract, which this preserves unchanged.
 */
import { defineCustomElement } from 'vue';
import { createI18n, I18nInjectionKey } from 'vue-i18n';
import WidgetPayPanel from '../components/WidgetPayPanel.vue';
import en from '../i18n/locales/en';
import fa from '../i18n/locales/fa';
// eslint-disable-next-line import/no-unresolved
import fontsCss from './shared/fonts.css?inline';

const TAG = 'packeta-pay-widget';
const SHEET_TAG = 'packeta-bottom-sheet';

// Vanilla (non-Vue) custom element for the bottomSheet presentation's chrome
// — a backdrop + sliding panel that hosts the pay widget via <slot>. Kept
// separate from PayWidgetElement/Vue on purpose: it's pure DOM chrome with
// no reactive state of its own, and giving it its own shadow root means its
// styles can never leak onto (or be leaked onto by) the host page, same
// isolation guarantee as the pay widget itself.
class PacketaBottomSheetElement extends HTMLElement {
  private onKeydownBound = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  connectedCallback() {
    const shadow = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
      }
      .backdrop {
        position: absolute;
        inset: 0;
        background: rgba(20, 33, 61, 0.5);
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .panel {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        max-width: 460px;
        margin: 0 auto;
        max-height: 92vh;
        overflow-y: auto;
        background: #eef3ff;
        border-radius: 20px 20px 0 0;
        box-shadow: 0 -8px 30px rgba(20, 33, 61, 0.25);
        transform: translateY(100%);
        transition: transform 0.25s cubic-bezier(0.32, 0.72, 0, 1);
        padding-bottom: max(4px, env(safe-area-inset-bottom));
      }
      :host(.open) .backdrop { opacity: 1; }
      :host(.open) .panel { transform: translateY(0); }
      .grabber {
        width: 36px;
        height: 4px;
        border-radius: 999px;
        background: #cbd5e1;
        margin: 10px auto 4px;
      }
      .close {
        position: absolute;
        top: 8px;
        inset-inline-end: 8px;
        width: 28px;
        height: 28px;
        border: none;
        border-radius: 999px;
        background: #ffffff;
        border: 1px solid #e3e9f7;
        color: #64748b;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
      }
    `;

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    const panel = document.createElement('div');
    panel.className = 'panel';
    const grabber = document.createElement('div');
    grabber.className = 'grabber';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    const slot = document.createElement('slot');

    panel.appendChild(grabber);
    panel.appendChild(closeBtn);
    panel.appendChild(slot);
    shadow.appendChild(style);
    shadow.appendChild(backdrop);
    shadow.appendChild(panel);

    backdrop.addEventListener('click', () => this.close());
    closeBtn.addEventListener('click', () => this.close());
    document.addEventListener('keydown', this.onKeydownBound);

    // Start off-screen (see the transform above) and flip to .open on the
    // next frame so the transition actually plays instead of snapping open.
    requestAnimationFrame(() => requestAnimationFrame(() => this.classList.add('open')));
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this.onKeydownBound);
  }

  close() {
    this.classList.remove('open');
    // Matches the panel's own transition-duration above — no reliable
    // single "both transitions finished" event to hook, so just wait it out.
    setTimeout(() => this.remove(), 250);
  }
}

function ensureSheetRegistered() {
  if (!customElements.get(SHEET_TAG)) {
    customElements.define(SHEET_TAG, PacketaBottomSheetElement);
  }
}

// See wallet.ts for why the combined styles array must be built by hand
// instead of passed straight into defineCustomElement's extraOptions, and
// why configureApp needs to install a fresh, per-instance i18n plugin.
const PayWidgetElement = defineCustomElement(WidgetPayPanel as any, {
  styles: [...(((WidgetPayPanel as any).styles as string[] | undefined) ?? []), fontsCss],
  // See wallet.ts for why app.provide(I18nInjectionKey, ...) is required
  // in addition to app.use() — vue-i18n's useI18n() resolves the
  // installed instance differently for a custom-element component.
  configureApp(app) {
    const widgetI18n = createI18n({
      legacy: false,
      locale: 'en',
      fallbackLocale: 'en',
      messages: { en, fa },
    });
    app.use(widgetI18n);
    app.provide(I18nInjectionKey, widgetI18n);
  },
}) as unknown as new () => HTMLElement & { authority?: string };

function ensureRegistered() {
  if (!customElements.get(TAG)) {
    customElements.define(TAG, PayWidgetElement);
  }
}

export interface MountPayWidgetOptions {
  // Required for the default 'inline' presentation; ignored for
  // 'bottomSheet', which mounts itself into document.body instead.
  target?: string | Element;
  redirectUrl: string;
  onComplete?: (result: { transactionId: string; status: 'COMPLETED' | 'FAILED' }) => void;
  // 'inline' (default): mounts flat into `target`, same as before.
  // 'bottomSheet': slides up from the bottom of the *whole host page* over
  // a backdrop — for a "pay now" button anywhere on the page rather than a
  // fixed spot in the layout. Dismissible by the customer via the close
  // button, the backdrop, or Escape; there's no programmatic close because
  // nothing needs one — once complete() fires the widget's own success
  // state is the right thing to keep showing.
  presentation?: 'inline' | 'bottomSheet';
  // Accepted for backward compatibility with the old iframe-based init()
  // signature — silently ignored, there's no iframe to size anymore.
  minHeight?: number;
}

export function mountPayWidget(options: MountPayWidgetOptions): Element {
  if (!options.redirectUrl) {
    throw new Error(
      'PacketaPay.init: "redirectUrl" is required — the redirectUrl your own /api/packeta/charge proxy returned.',
    );
  }

  const match = new URL(options.redirectUrl, window.location.href).pathname.match(/\/pay\/([^/]+)/);
  if (!match) {
    throw new Error('PacketaPay.init: could not parse an authority out of "redirectUrl".');
  }
  const authority = match[1];

  ensureRegistered();
  const el = document.createElement(TAG) as InstanceType<typeof PayWidgetElement>;
  el.authority = authority;

  if (options.onComplete) {
    el.addEventListener('complete', (e: Event) => {
      // Vue's custom-element wrapper translates a component's emit() calls
      // into a CustomEvent whose args are wrapped as CustomEvent.detail
      // (an array — one entry per emit argument).
      const [result] = (e as CustomEvent).detail;
      options.onComplete!(result);
    });
  }

  if (options.presentation === 'bottomSheet') {
    ensureSheetRegistered();
    const sheet = document.createElement(SHEET_TAG);
    sheet.appendChild(el);
    document.body.appendChild(sheet);
    return el;
  }

  const container =
    typeof options.target === 'string' ? document.querySelector(options.target) : options.target;
  if (!container) {
    throw new Error('PacketaPay.init: "target" must be an element or a selector that matches one.');
  }
  container.innerHTML = '';
  container.appendChild(el);
  return el;
}

function autoWireOne(el: Element) {
  const proxyUrl = el.getAttribute('data-proxy-url');
  const amount = Number(el.getAttribute('data-amount'));
  const currency = el.getAttribute('data-currency');
  if (!proxyUrl || !amount || !currency) return;

  fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount,
      currency,
      language: el.getAttribute('data-language') || undefined,
    }),
  })
    .then((res) =>
      res
        .json()
        .catch(() => null)
        .then((data) => {
          if (!res.ok) {
            const message =
              (data && data.message) || `Checkout could not be started (HTTP ${res.status})`;
            throw new Error(message);
          }
          return data;
        }),
    )
    .then((data) => {
      const presentation = el.getAttribute('data-presentation');
      mountPayWidget({
        redirectUrl: data.redirectUrl,
        target: el,
        presentation: presentation === 'bottomSheet' ? 'bottomSheet' : undefined,
      });
    })
    .catch((err) => {
      el.textContent = err.message;
    });
}

function autoWire() {
  const containers = document.querySelectorAll('[data-packeta-pay-widget]');
  containers.forEach((container) => {
    // Guard against double-wiring if this script is ever included twice.
    if (!container.hasAttribute('data-packeta-wired')) {
      container.setAttribute('data-packeta-wired', 'true');
      autoWireOne(container);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoWire);
} else {
  autoWire();
}

(window as any).PacketaPay = { init: mountPayWidget };
