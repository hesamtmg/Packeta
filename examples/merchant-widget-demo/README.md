# merchant-widget-demo

A minimal "merchant host" site that embeds the Packeta wallet-viewing
widget. This is both a manual test rig for `sdk/js/wallet-widget.js` and a
second, real reference implementation alongside `sdk/js/server-example.js`.

It reuses `server-example.js` directly (not a copy), so testing this is
testing the actual thing merchants get.

## Setup

```bash
npm install
```

You need a Packeta merchant account whose wallet has the widget feature
turned on:

1. Log into the Packeta admin panel as a super-admin.
2. On **Wallet Types**, find (or create) a `MERCHANT`-code type and check
   **Allow wallet-viewing widget**. Leave **Widget requires OTP** checked for
   the OTP-mode test, or uncheck it for the non-OTP-mode test.
3. Create (or use an existing) merchant wallet of that type, logged in as
   that merchant. Copy its wallet ID from its detail page — the same page
   also shows this exact embed snippet pre-filled.

## Run

```bash
PACKETA_API_URL=http://localhost:3000 \
PACKETA_EMAIL=merchant@example.com \
PACKETA_PASSWORD=your-merchant-password \
npm start
```

Then open <http://localhost:4100>.

## Testing both modes

- **OTP mode** (`widgetRequiresOtp` on): paste the wallet ID, leave phone
  number blank, click "Show my wallets". The widget asks for a phone
  number, shows a captcha, sends a (sandbox) OTP code, then the wallet
  list.
- **Non-OTP mode** (`widgetRequiresOtp` off): paste the wallet ID *and* a
  phone number that has a real Packeta account, click "Show my wallets".
  The widget skips straight to the wallet list — no code, no captcha.

The devCode/OTP sandbox behavior is the same as the regular pay flow — no
real SMS is sent; the widget's own OTP screen surfaces the code directly
for testing.
