# Packeta JS — the "no UI engineer" integration

This folder is everything you need to accept a Packeta payment on an
existing website without designing or building any payment screens. The
payment UI (phone entry, OTP, wallet picker, confirm) is hosted by Packeta
itself — you only need a button and one small server endpoint.

Two files:

- **`packeta.js`** — a zero-dependency browser script. Drop it on your page
  and add a button; no build step, no framework required.
- **`server-example.js`** — a small Express reference for the one thing
  that has to happen server-side: holding your Packeta login and opening
  the charge. Translate it to whatever backend you already run — it's
  three HTTP calls' worth of logic.

For the full API reference behind both of these, see
[`../../docs/THIRD_PARTY_INTEGRATION.md`](../../docs/THIRD_PARTY_INTEGRATION.md).

## Quickstart

### 1. Wire up the server endpoint

Copy `server-example.js` into your backend (or port the logic — it's short)
and set three environment variables:

```
PACKETA_API_URL=https://api.packeta.example.com
PACKETA_EMAIL=your-merchant-account@example.com
PACKETA_PASSWORD=your-merchant-account-password
```

Mount it in your app:

```js
const packeta = require('./server-example');
app.use(packeta);
```

This gives you two routes:

- `POST /api/packeta/charge` — the button below calls this.
- `POST /webhooks/packeta` — point your Packeta merchant wallet's
  `callbackUrl` at this (see the dashboard/admin panel, or ask whoever set
  up your wallet). This is how you find out a payment actually completed.

### 2. Add a button to your page

```html
<button
  data-packeta-pay
  data-proxy-url="/api/packeta/charge"
  data-amount="125000"
  data-currency="USD"
>
  Pay $1,250.00
</button>
<p data-packeta-error></p>

<script src="/packeta.js"></script>
```

- `data-amount` is an integer in **minor units** — cents for USD, so
  `125000` is $1,250.00. (Rials, for IRR, has no decimal places — the
  amount is the Rial count directly.)
- `data-packeta-error` is optional — if present, error messages are written
  there instead of falling back to a browser `alert()`.

That's the whole integration. Clicking the button redirects the customer to
Packeta's hosted pay page; when they finish (or the charge fails/expires),
your webhook fires and you mark the order accordingly.

### 3. (If you'd rather wire your own button/cart logic)

```html
<script src="/packeta.js"></script>
<script>
  document.getElementById('checkout-btn').addEventListener('click', function () {
    Packeta.pay({
      proxyUrl: '/api/packeta/charge',
      amount: cartTotalInCents,
      currency: 'USD',
    }).catch(function (err) {
      showMyOwnErrorUI(err.message);
    });
  });
</script>
```

`Packeta.pay()` returns a Promise. On success it redirects the page itself
(you won't see the Promise resolve) — the `.catch()` is where you handle
failures (network error, validation error from your own proxy, etc.).

## What you're intentionally not building

- No form for card/wallet details — the customer never enters payment
  credentials on your site.
- No OTP or phone-verification UI.
- No "select a wallet" screen.
- No PCI-relevant data ever touches your server or browser.

All of that lives on Packeta's hosted pay page. If you later *do* want a
fully custom, embedded payment UI instead of a redirect, that's possible
too (see §7, "Building a custom pay page," in the integration guide) — but
it needs real frontend engineering, which is exactly what this drop-in
avoids.
