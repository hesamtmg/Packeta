/*!
 * pay-widget.js — an embeddable, iframe version of the "Pay with Packeta"
 * checkout, as an alternative to packeta.js's full-page redirect. Same
 * charge underneath (your server still calls the exact same
 * POST /transactions/purchase/charge via your existing /api/packeta/charge
 * proxy — see server-example.js) — this just shows the phone/OTP/wallet/
 * confirm steps inline instead of navigating your whole page away.
 *
 * Zero dependencies, no build step — paste this file onto your site as-is.
 *
 * Declarative usage (reuses the exact same proxy route packeta.js uses):
 *
 *   <div data-packeta-pay-widget
 *        data-proxy-url="/api/packeta/charge"
 *        data-amount="125000"
 *        data-currency="USD"
 *   ></div>
 *   <script src="/pay-widget.js"></script>
 *
 * "amount" is an integer in minor units (cents), same convention as
 * packeta.js. If you already have a wired-up Pay button, no new server
 * code is needed to also use this widget — same endpoint, same response
 * shape, just handed to a different init function.
 *
 * Programmatic usage (if you already called your proxy yourself, e.g. to
 * reuse the result for a fallback link):
 *
 *   fetch('/api/packeta/charge', { method: 'POST', body: JSON.stringify({ amount, currency }) })
 *     .then((res) => res.json())
 *     .then((charge) => PacketaPay.init({
 *       redirectUrl: charge.redirectUrl,
 *       target: '#packeta-checkout',
 *       onComplete: (result) => console.log(result.status),
 *     }));
 *
 * onComplete({ transactionId, status }) fires once the purchase settles —
 * status is 'COMPLETED' or 'FAILED'. Nothing about the purchase ever
 * navigates your page away, *except* the one case that genuinely can't
 * avoid it: a CREDIT wallet whose balance falls short pays the difference
 * through ZarinPal, a real external gateway that refuses to render inside
 * any iframe — that click breaks out to a full-page redirect and the
 * customer lands back wherever your Packeta wallet's own callbackUrl
 * points once it's done (see the admin panel's wallet settings).
 */
(function (window, document) {
  'use strict';

  // See wallet-widget.js for the identical rationale on each token —
  // allow-top-navigation-by-user-activation exists solely for the
  // credit-shortfall ZarinPal breakout above, gated on a real click.
  var IFRAME_SANDBOX =
    'allow-scripts allow-forms allow-same-origin allow-top-navigation-by-user-activation';

  function init(options) {
    options = options || {};
    var target = options.target;
    var container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) {
      throw new Error('PacketaPay.init: "target" must be an element or a selector that matches one.');
    }
    if (!options.redirectUrl) {
      throw new Error('PacketaPay.init: "redirectUrl" is required — the redirectUrl your own /api/packeta/charge proxy returned.');
    }

    var widgetUrl = options.redirectUrl.replace('/pay/', '/pay-widget/');

    var iframe = document.createElement('iframe');
    iframe.src = widgetUrl;
    iframe.setAttribute('sandbox', IFRAME_SANDBOX);
    iframe.style.width = '100%';
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    iframe.style.minHeight = (options.minHeight || 200) + 'px';
    iframe.title = 'Packeta checkout';

    container.innerHTML = '';
    container.appendChild(iframe);

    window.addEventListener('message', function (event) {
      var data = event.data;
      if (!data || event.source !== iframe.contentWindow) return;
      if (data.type === 'packeta-widget-resize' && typeof data.height === 'number') {
        iframe.style.height = data.height + 'px';
      } else if (data.type === 'packeta-payment-complete' && options.onComplete) {
        options.onComplete({ transactionId: data.transactionId, status: data.status });
      }
    });

    return iframe;
  }

  function autoWireOne(el) {
    var proxyUrl = el.getAttribute('data-proxy-url');
    var amount = Number(el.getAttribute('data-amount'));
    var currency = el.getAttribute('data-currency');
    if (!proxyUrl || !amount || !currency) return;

    fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amount,
        currency: currency,
        language: el.getAttribute('data-language') || undefined,
      }),
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return null;
          })
          .then(function (data) {
            if (!res.ok) {
              var message = (data && data.message) || 'Checkout could not be started (HTTP ' + res.status + ')';
              throw new Error(message);
            }
            return data;
          });
      })
      .then(function (data) {
        init({ redirectUrl: data.redirectUrl, target: el });
      })
      .catch(function (err) {
        el.textContent = err.message;
      });
  }

  function autoWire() {
    var containers = document.querySelectorAll('[data-packeta-pay-widget]');
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

  window.PacketaPay = { init: init };
})(window, document);
