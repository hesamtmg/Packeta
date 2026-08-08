/*!
 * Packeta.js — a drop-in "Pay with Packeta" button. No payment UI to build:
 * the actual payment screen (phone entry, OTP, wallet picker, confirm) is
 * hosted by Packeta itself. This script only asks your own server to open a
 * charge, then redirects the browser there.
 *
 * Zero dependencies, no build step — paste this file onto your site as-is.
 *
 * Declarative usage (no JS required beyond including this file):
 *
 *   <button data-packeta-pay
 *           data-proxy-url="/api/packeta/charge"
 *           data-amount="125000"
 *           data-currency="USD">
 *     Pay $1,250.00
 *   </button>
 *   <p data-packeta-error></p>  <!-- optional: error text lands here instead of an alert() -->
 *   <script src="/packeta.js"></script>
 *
 * Programmatic usage:
 *
 *   Packeta.pay({ proxyUrl: '/api/packeta/charge', amount: 125000, currency: 'USD' })
 *     .catch((err) => showMyOwnError(err.message));
 *
 * In both cases "amount" is an integer in minor units (e.g. cents — 125000
 * is $1,250.00) and "proxyUrl" points at an endpoint on YOUR OWN server,
 * not Packeta directly — see server-example.js in this same folder for why
 * (your Packeta API credentials must never reach the browser) and for a
 * working reference implementation of that endpoint.
 */
(function (window, document) {
  'use strict';

  // Creates a charge via your server-side proxy and redirects the browser
  // to Packeta's hosted pay page. Returns a Promise that only resolves if
  // options.redirect is explicitly set to false (otherwise the page
  // navigates away before there's anything left to do with the result).
  function pay(options) {
    options = options || {};
    var proxyUrl = options.proxyUrl;
    if (!proxyUrl) {
      return Promise.reject(
        new Error('Packeta.pay: "proxyUrl" is required — point it at your own server endpoint that creates the charge (see server-example.js).'),
      );
    }
    if (!options.amount || !options.currency) {
      return Promise.reject(new Error('Packeta.pay: "amount" and "currency" are required.'));
    }

    var body = {
      amount: options.amount,
      currency: options.currency,
    };
    if (options.language) body.language = options.language;
    if (options.metadata) body.metadata = options.metadata;

    return fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (res) {
        return res.json().catch(function () {
          return null;
        }).then(function (data) {
          if (!res.ok) {
            var message = (data && data.message) || 'Payment could not be started (HTTP ' + res.status + ')';
            throw new Error(message);
          }
          return data;
        });
      })
      .then(function (data) {
        if (!data || !data.redirectUrl) {
          throw new Error('Packeta.pay: your proxy response is missing "redirectUrl".');
        }
        if (options.redirect === false) {
          return data;
        }
        window.location.href = data.redirectUrl;
        return data;
      });
  }

  function findErrorTarget(button) {
    var explicitId = button.getAttribute('data-error-target');
    if (explicitId) {
      return document.getElementById(explicitId);
    }
    var sibling = button.nextElementSibling;
    return sibling && sibling.hasAttribute('data-packeta-error') ? sibling : null;
  }

  function setLoading(button) {
    button.disabled = true;
    button.setAttribute('data-packeta-original-text', button.textContent);
    button.textContent = button.getAttribute('data-loading-text') || 'Redirecting…';
    var errorEl = findErrorTarget(button);
    if (errorEl) errorEl.textContent = '';
  }

  function setError(button, message) {
    button.disabled = false;
    var original = button.getAttribute('data-packeta-original-text');
    if (original) button.textContent = original;
    var errorEl = findErrorTarget(button);
    if (errorEl) {
      errorEl.textContent = message;
    } else {
      window.alert(message);
    }
  }

  function wireButton(button) {
    button.addEventListener('click', function () {
      setLoading(button);
      pay({
        proxyUrl: button.getAttribute('data-proxy-url'),
        amount: Number(button.getAttribute('data-amount')),
        currency: button.getAttribute('data-currency'),
        language: button.getAttribute('data-language') || undefined,
      }).catch(function (err) {
        setError(button, err.message);
      });
    });
  }

  function autoWire() {
    var buttons = document.querySelectorAll('[data-packeta-pay]');
    for (var i = 0; i < buttons.length; i++) {
      // Guard against double-wiring if this script is ever included twice.
      if (!buttons[i].hasAttribute('data-packeta-wired')) {
        buttons[i].setAttribute('data-packeta-wired', 'true');
        wireButton(buttons[i]);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoWire);
  } else {
    autoWire();
  }

  window.Packeta = { pay: pay };
})(window, document);
