/*!
 * Native-mount entry for the account widget — compiled by
 * `npm run build:widget:wallet` into sdk/js/wallet-widget.js. Mounts
 * WidgetAccountPanel.vue directly into the host page via a Vue Custom
 * Element (its own Shadow DOM, no iframe). See sdk/js/README.md for the
 * merchant-facing integration contract, which this preserves unchanged.
 */
import { defineCustomElement } from 'vue';
import { createI18n, I18nInjectionKey } from 'vue-i18n';
import WidgetAccountPanel from '../components/WidgetAccountPanel.vue';
import en from '../i18n/locales/en';
import fa from '../i18n/locales/fa';
// eslint-disable-next-line import/no-unresolved
import fontsCss from './shared/fonts.css?inline';

const TAG = 'packeta-wallet-widget';

// defineCustomElement(Comp, extraOptions) does a shallow Object.assign,
// which would OVERWRITE Comp.styles (the component's own compiled CSS,
// present because vite.widget.config.ts compiles this file in
// `customElement` mode) rather than merge it — build the combined array
// ourselves so the panel's own scoped styles and the shared font-face
// rules both end up injected into the shadow root.
const WalletWidgetElement = defineCustomElement(WidgetAccountPanel as any, {
  styles: [...(((WidgetAccountPanel as any).styles as string[] | undefined) ?? []), fontsCss],
  // The panel calls useI18n() expecting an installed vue-i18n plugin — with
  // no host SPA around it anymore, this widget must install its own. A
  // fresh createI18n() per mounted instance (rather than importing
  // ipg-frontend's shared ../i18n singleton) keeps every widget instance's
  // language fully independent, matching the WidgetAccountPanel's own
  // locale.value-based (not document.documentElement-based) locale
  // handling — see WidgetAccountPanel.vue's onMounted.
  //
  // app.use() alone isn't enough here: vue-i18n's useI18n() resolves the
  // installed instance differently for a custom-element component
  // (instance.isCE) — it injects a fixed I18nInjectionKey instead of the
  // per-app symbol app.use() provides under, so that key has to be
  // provided explicitly too (confirmed by reading vue-i18n's
  // getI18nInstance()/useI18n() source directly).
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
}) as unknown as new () => HTMLElement & { token?: string; returnUrl?: string };

function ensureRegistered() {
  // customElements.define() throws if called twice with the same tag name —
  // guard so it's still safe to include this script more than once on a
  // page, matching the old plain-IIFE script's behavior.
  if (!customElements.get(TAG)) {
    customElements.define(TAG, WalletWidgetElement);
  }
}

export interface MountAccountWidgetOptions {
  target: string | Element;
  sessionToken?: string;
  baseUrl?: string;
  widgetUrl?: string;
  returnUrl?: string;
  // Accepted for backward compatibility with the old iframe-based init()
  // signature — silently ignored, there's no iframe to size anymore.
  minHeight?: number;
}

function resolveToken(options: MountAccountWidgetOptions): string {
  if (options.sessionToken) return options.sessionToken;
  if (options.widgetUrl) {
    const match = options.widgetUrl.match(/\/widget\/([^/?]+)/);
    if (match) return match[1];
    throw new Error('PacketaWallet.init: could not parse a session token out of "widgetUrl".');
  }
  throw new Error(
    'PacketaWallet.init: pass either "widgetUrl" (from your server\'s session response) or "sessionToken".',
  );
}

export function mountAccountWidget(options: MountAccountWidgetOptions): Element {
  const container =
    typeof options.target === 'string' ? document.querySelector(options.target) : options.target;
  if (!container) {
    throw new Error(
      'PacketaWallet.init: "target" must be an element or a selector that matches one.',
    );
  }

  const token = resolveToken(options);
  // Never stored anywhere — just carried through to the ZarinPal callback
  // URL a deposit/installment payment builds server-side (see backend
  // WidgetService.buildWidgetCallbackUrl), so the widget can send the
  // browser back here once that leg completes.
  const returnUrl = options.returnUrl || window.location.href;

  ensureRegistered();
  const el = document.createElement(TAG) as InstanceType<typeof WalletWidgetElement>;
  // Set props before appendChild — Vue's custom-element wrapper reads
  // initial prop values on connectedCallback, so this order matters for
  // the very first render to have correct data.
  el.token = token;
  el.returnUrl = returnUrl;

  container.innerHTML = '';
  container.appendChild(el);
  return el;
}

function autoWireOne(el: Element) {
  const walletId = el.getAttribute('data-wallet-id');
  const proxyUrl = el.getAttribute('data-proxy-url');
  if (!walletId || !proxyUrl) return;
  // Only needed for a wallet type with widgetRequiresOtp off — see
  // README.md's "non-OTP" mode. Ignored by your proxy/Packeta otherwise.
  const phoneNumber = el.getAttribute('data-phone-number');

  fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletId, phoneNumber: phoneNumber || undefined }),
  })
    .then((res) =>
      res
        .json()
        .catch(() => null)
        .then((data) => {
          if (!res.ok) {
            const message =
              (data && data.message) || `Wallet widget could not be started (HTTP ${res.status})`;
            throw new Error(message);
          }
          return data;
        }),
    )
    .then((data) => {
      mountAccountWidget({
        widgetUrl: data.widgetUrl,
        sessionToken: data.sessionToken,
        target: el,
        returnUrl: el.getAttribute('data-return-url') || undefined,
      });
    })
    .catch((err) => {
      el.textContent = err.message;
    });
}

function autoWire() {
  const containers = document.querySelectorAll('[data-packeta-wallet]');
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

(window as any).PacketaWallet = { init: mountAccountWidget };
