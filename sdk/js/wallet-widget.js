/*!
 * wallet-widget.js — shows a logged-in customer their own Packeta wallets,
 * inline on your site. No wallet/OTP UI to build: the actual UI (phone
 * entry if needed, OTP if your wallet type requires it, the wallet list
 * itself) is hosted by Packeta inside a sandboxed iframe. Your page's JS
 * never sees a phone number being typed, an OTP code, or any Packeta
 * credential — only a short-lived, single-purpose session token your own
 * server minted server-to-server.
 *
 * Zero dependencies, no build step — paste this file onto your site as-is.
 *
 * Declarative usage (no JS required beyond including this file):
 *
 *   <div data-packeta-wallet
 *        data-wallet-id="0f27...-your-merchant-wallet-id"
 *        data-proxy-url="/api/packeta/widget-session"
 *   ></div>
 *   <script src="/wallet-widget.js"></script>
 *
 * Add data-phone-number="+15551234567" on the container above only if the
 * wallet type's widgetRequiresOtp is turned off (a merchant asserting a
 * phone number it already trusts, instead of a live OTP challenge) — it's
 * ignored otherwise.
 *
 * Add data-return-url="https://yoursite.example.com/account" to control
 * where the browser lands after a deposit or installment payment's ZarinPal
 * leg completes (a real external gateway — it can't run inside this
 * iframe, so that one click genuinely leaves your page and comes back).
 * Defaults to the current page's own URL if omitted.
 *
 * Programmatic usage (if you already have a session token from your own
 * server, e.g. because you fetched it as part of a larger page load):
 *
 *   PacketaWallet.init({
 *     sessionToken: session.sessionToken,
 *     widgetUrl: session.widgetUrl,
 *     target: '#packeta-wallet',
 *   });
 *
 * In both cases the session token/widgetUrl come from YOUR OWN server (see
 * server-example.js's POST /api/packeta/widget-session in this same folder)
 * — never call Packeta's /widget/sessions endpoint directly from the
 * browser, since that one needs your real merchant login.
 *
 * Only a MERCHANT-type wallet with the widget feature turned on (see the
 * admin panel's Wallet Types page) can mint a session at all.
 */
(function (window, document) {
  'use strict';

  // Widget sessions carry no data of their own beyond what's inside the
  // iframe — allow-same-origin is needed only so the iframe (served by
  // Packeta's own ipg-frontend origin) can read/write its own storage for
  // its normal app operation, not so this host page can reach into it.
  // allow-top-navigation-by-user-activation lets a real click inside the
  // iframe (Deposit / Pay installment) send the *top-level* browser tab to
  // ZarinPal — a genuine external payment gateway that refuses to render
  // inside any iframe. Gated on transient user activation, so a script
  // can't trigger it on its own; this is deliberate, not a sandbox-escape
  // oversight.
  var IFRAME_SANDBOX =
    'allow-scripts allow-forms allow-same-origin allow-top-navigation-by-user-activation';

  function init(options) {
    options = options || {};
    var target = options.target;
    var container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) {
      throw new Error('PacketaWallet.init: "target" must be an element or a selector that matches one.');
    }

    var widgetUrl = options.widgetUrl;
    if (!widgetUrl) {
      if (!options.sessionToken || !options.baseUrl) {
        throw new Error(
          'PacketaWallet.init: pass either "widgetUrl" (from your server\'s session response) or both "sessionToken" and "baseUrl".',
        );
      }
      widgetUrl = options.baseUrl.replace(/\/$/, '') + '/widget/' + options.sessionToken;
    }

    // Never stored anywhere — just carried through as a query param on the
    // ZarinPal callback URL a deposit/installment payment builds server-side
    // (see backend WidgetService.buildWidgetCallbackUrl), so the widget can
    // send the browser back here once that leg completes.
    var returnUrl = options.returnUrl || window.location.href;
    widgetUrl += (widgetUrl.indexOf('?') === -1 ? '?' : '&') + 'returnUrl=' + encodeURIComponent(returnUrl);

    var iframe = document.createElement('iframe');
    iframe.src = widgetUrl;
    iframe.setAttribute('sandbox', IFRAME_SANDBOX);
    iframe.style.width = '100%';
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    iframe.style.minHeight = (options.minHeight || 160) + 'px';
    iframe.title = 'Packeta wallets';

    container.innerHTML = '';
    container.appendChild(iframe);

    // The widget posts its own content height on every step change (see
    // ipg-frontend WidgetView.vue) so the iframe never shows an internal
    // scrollbar or clips content — checking e.source ties the resize to
    // this exact iframe even if more than one widget is on the page.
    window.addEventListener('message', function (event) {
      var data = event.data;
      if (
        data &&
        data.type === 'packeta-widget-resize' &&
        event.source === iframe.contentWindow &&
        typeof data.height === 'number'
      ) {
        iframe.style.height = data.height + 'px';
      }
    });

    return iframe;
  }

  function autoWireOne(el) {
    var walletId = el.getAttribute('data-wallet-id');
    var proxyUrl = el.getAttribute('data-proxy-url');
    if (!walletId || !proxyUrl) return;
    // Only needed for a wallet type with widgetRequiresOtp off — see
    // README.md's "non-OTP" mode. Ignored by your proxy/Packeta otherwise.
    var phoneNumber = el.getAttribute('data-phone-number');

    fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletId: walletId, phoneNumber: phoneNumber || undefined }),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {
            if (!res.ok) {
              var message = (data && data.message) || 'Wallet widget could not be started (HTTP ' + res.status + ')';
              throw new Error(message);
            }
            return data;
          });
      })
      .then(function (data) {
        init({
          widgetUrl: data.widgetUrl,
          sessionToken: data.sessionToken,
          target: el,
          returnUrl: el.getAttribute('data-return-url') || undefined,
        });
      })
      .catch(function (err) {
        el.textContent = err.message;
      });
  }

  function autoWire() {
    var containers = document.querySelectorAll('[data-packeta-wallet]');
    for (var i = 0; i < containers.length; i++) {
      // Guard against double-wiring if this script is ever included twice.
      if (!containers[i].hasAttribute('data-packeta-wired')) {
        containers[i].setAttribute('data-packeta-wired', 'true');
        autoWireOne(containers[i]);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoWire);
  } else {
    autoWire();
  }

  window.PacketaWallet = { init: init };
})(window, document);
