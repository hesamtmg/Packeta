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
  target: string | Element;
  redirectUrl: string;
  onComplete?: (result: { transactionId: string; status: 'COMPLETED' | 'FAILED' }) => void;
  // Accepted for backward compatibility with the old iframe-based init()
  // signature — silently ignored, there's no iframe to size anymore.
  minHeight?: number;
}

export function mountPayWidget(options: MountPayWidgetOptions): Element {
  const container =
    typeof options.target === 'string' ? document.querySelector(options.target) : options.target;
  if (!container) {
    throw new Error('PacketaPay.init: "target" must be an element or a selector that matches one.');
  }
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
      mountPayWidget({ redirectUrl: data.redirectUrl, target: el });
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
