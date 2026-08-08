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

## Show a customer's wallets inline

A second, separate widget: if your site already has its own logged-in
customer and you want to show *their* Packeta wallets and balances inline
(not process a payment), use **`wallet-widget.js`** instead. Same idea as
the pay button — the actual UI is hosted by Packeta inside a sandboxed
iframe, and your page's JS never sees a phone number, an OTP code, or any
Packeta credential.

This only works for a **MERCHANT**-type wallet with the widget feature
turned on for its wallet type (an admin toggles this on the Wallet Types
page — see `allowWidget` / `widgetRequiresOtp`). `widgetRequiresOtp`
controls how the customer is identified inside the iframe:

- **On (default):** the customer types their phone number (or confirms one
  you pre-supplied) and completes a live OTP challenge, same as the pay
  flow's phone/OTP step.
- **Off:** you assert the phone number yourself when you mint the session
  (because your own site already verified who this customer is) and the
  widget skips straight to the wallet list — no code, no live challenge.
  Only turn this on for a merchant you actually trust to assert phone
  numbers correctly, since it removes the live verification step.

### 1. Wire up the server endpoint

Same `server-example.js` file as above adds one more route:

- `POST /api/packeta/widget-session` — mints a session for a given
  `walletId` (the merchant wallet you want to show, from your admin panel's
  Wallet detail page). Add `phoneNumber` to the request body too if
  `widgetRequiresOtp` is off for that wallet type.

### 2. Add the widget to your page

```html
<div
  data-packeta-wallet
  data-wallet-id="0f27...-your-merchant-wallet-id"
  data-proxy-url="/api/packeta/widget-session"
></div>
<script src="/wallet-widget.js"></script>
```

That's it — the script finds the `div`, asks your proxy for a session, and
embeds the widget iframe in its place, resizing itself automatically as the
customer moves through phone/OTP/wallet-list steps.

Your wallet's own detail page in the Packeta admin panel has this exact
snippet pre-filled with your `walletId`, ready to copy.

### 3. (If you'd rather call it yourself)

```html
<div id="packeta-wallet"></div>
<script src="/wallet-widget.js"></script>
<script>
  fetch('/api/packeta/widget-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletId: 'your-merchant-wallet-id' }),
  })
    .then(function (res) { return res.json(); })
    .then(function (session) {
      PacketaWallet.init({
        sessionToken: session.sessionToken,
        widgetUrl: session.widgetUrl,
        target: '#packeta-wallet',
      });
    });
</script>
```
