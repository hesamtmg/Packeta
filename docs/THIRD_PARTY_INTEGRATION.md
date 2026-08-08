# Packeta Wallet & Payment Integration Guide

This is the reference for a third party integrating with Packeta to (a) read wallet
data and (b) accept a payment. It covers two integration shapes:

- **Self-service merchant** — you have your own Packeta account and a merchant
  wallet, and you call the API directly from your backend.
- **Admin-issued charge** — a Packeta administrator creates the charge on your
  behalf (no Packeta account needed on your side).

Everything below is expressed in terms of the real endpoints, request/response
shapes, and field names as implemented — not a simplified sketch.

> **No frontend engineer on your team?** You don't need one — Packeta hosts
> the entire payment UI (phone entry, OTP, wallet picker, confirm). See
> [`../sdk/js/`](../sdk/js/) for a drop-in `<script>` + a small server
> snippet that gets you a working "Pay with Packeta" button with zero
> custom payment screens.

---

## 0. Base URLs

| Service | Dev default | Purpose |
|---|---|---|
| Packeta API (backend) | `http://localhost:3000` | Everything in this doc except step 4 of the payment flow |
| Customer web app (frontend) | `http://localhost:5173` | Not used by integrators directly |
| IPG pay page (ipg-frontend) | `http://localhost:5174` | Where you redirect the customer's browser to pay |

In production, replace these with your Packeta deployment's real hostnames. All
requests below assume `Content-Type: application/json` unless noted.

---

## 1. Authentication

Every non-public endpoint requires a JWT bearer token.

### Email/password

```
POST /auth/login
{ "email": "merchant@example.com", "password": "..." }

→ 200 { "accessToken": "<jwt>" }
```

### Phone + OTP (alternative login/signup — first successful OTP verify auto-creates the account)

```
GET  /auth/phone/captcha                          → { captchaId, image }
POST /auth/phone/request-otp
     { phoneNumber, captchaId, captchaAnswer }     → { devCode }   (sandbox only — no SMS provider wired up)
POST /auth/phone/verify-otp
     { phoneNumber, code }                         → { accessToken }
```

Attach the token to every subsequent request:

```
Authorization: Bearer <accessToken>
```

`GET /users/me` returns `{ id, email, role, panelRole }` for the authenticated
account — useful to confirm the token is valid and see what role you're acting
as (`USER`, `ADMIN`, `SUPER_ADMIN`).

---

## 2. Fetching wallets

```
GET /wallets            → Wallet[]   (every wallet the authenticated user owns)
GET /wallets/:id        → Wallet     (one wallet you own)
```

### Wallet shape

```jsonc
{
  "id": "uuid",
  "name": "My Store USD",              // optional display name you set
  "balance": "125000",                 // STRING, minor units — see §2.1
  "purchaseTimeoutSeconds": 900,
  "restrictedCounterparties": null,    // closed-marketplace allowlist, or null
  "closedAt": null,
  "blockedAt": null,                   // set only for CREDIT wallets overdue on repayment
  "terminalId": "T001",
  "acceptorCode": "A001",
  "minTransactionAmount": null,
  "maxTransactionAmount": null,
  "storeName": "My Store",
  "storeSite": "https://mystore.example.com",
  "allowedIps": null,
  "callbackUrl": "https://mystore.example.com/webhooks/packeta",
  "category": "retail",
  "subCategory": null,
  "virtualAmount": null,               // CREDIT wallets only
  "nationalCode": null,
  "repositoryWalletId": null,          // CREDIT wallets only
  "railType": null,
  "railScheduleTimes": null,
  "settlementAccounts": [],
  "walletType": {
    "id": "uuid",
    "code": "MERCHANT",
    "name": "Merchant",
    "allowNegativeBalance": false,
    "creditLimit": null,
    "allowWithdraw": true,
    "allowP2pOut": false,
    "allowP2pIn": false,
    "supportsAutoWithdraw": true,
    "autoWithdrawTimes": ["03:00"],
    "allowPurchaseOut": false,
    "allowPurchaseIn": true,
    "depositable": false,
    "hasVirtualBalance": false,
    "installmentDate": null,
    "paymentDeadlineDate": null,
    "feePercent": null,
    "penaltyPercentPerDay": null,
    "unblockFee": null,
    "installmentCount": null,
    "currency": {
      "code": "USD",
      "symbol": "$",
      "symbolPosition": "PREFIX",
      "decimalPlaces": 2
    }
  },
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

### 2.1 Minor units — read this before formatting any amount

Every `amount`/`balance` field is a **string-encoded integer in minor units**
(the smallest unit of the currency — cents for USD, Rials for IRR — never a
decimal). Divide by `10 ** walletType.currency.decimalPlaces` to get a display
value:

```
displayAmount = Number(amount) / 10 ** currency.decimalPlaces
// e.g. "125000" with decimalPlaces: 2  →  1250.00 USD
```

Amounts are strings (not JSON numbers) because they can exceed
`Number.MAX_SAFE_INTEGER` for large-denomination currencies — parse as
`BigInt` if you're doing arithmetic on them server-side, not `Number`.

### 2.2 Setting up a merchant wallet

To receive payments you need a wallet whose `walletType.allowPurchaseIn` is
`true` (ask your Packeta admin which wallet type/currency to use, or create
one yourself if self-service signup is enabled):

```
POST /wallets
{
  "walletTypeId": "<merchant-type-uuid>",
  "name": "My Store USD",
  "storeName": "My Store",
  "storeSite": "https://mystore.example.com",
  "terminalId": "T001",
  "acceptorCode": "A001",
  "allowedIps": ["203.0.113.10"],          // optional: only these IPs may call purchase/charge for this wallet
  "callbackUrl": "https://mystore.example.com/webhooks/packeta",   // must be https
  "category": "retail",
  "purchaseTimeoutSeconds": 900,           // how long a charge stays open, default 900s
  "settlementAccounts": [                  // optional default payout split
    { "iban": "IR...", "label": "Main account", "percent": 100 }
  ]
}
```

`CREDIT` and `SUPPORT` wallet types cannot be created through this endpoint —
those are provisioned by other flows and are not relevant to accepting
payments.

---

## 3. Idempotency

Every state-changing customer action (`deposit`, `withdraw`, `transfer`,
`purchase/initiate`, `purchase/charge`, `installments/:id/pay`, `:id/reverse`)
requires an `Idempotency-Key` header — any client-generated unique string
(a UUID is fine).

- Same key + same request body → the original response is replayed, the
  operation is **not** repeated.
- Same key + a **different** body → `409 Conflict`,
  `"Idempotency key was already used for a different request"`.
- Same key while the first call is still in flight → `409 Conflict`,
  `"A request with this idempotency key is already being processed"`.

Generate a fresh key per logical action (e.g. per checkout attempt), and
reuse the same key if you retry that exact same request after a network
failure — that's what makes the retry safe.

---

## 4. Accepting a payment — self-service merchant

This is the path for a merchant with their own Packeta account and API
credentials, charging a customer who is *not* required to have a Packeta
session in advance (they're identified by phone at the pay page).

```
you (backend)                 Packeta API                 IPG pay page                 customer
     |  POST /transactions/purchase/charge |                            |                    |
     |------------------------------------->|                            |                    |
     |  { transactionId, redirectUrl }      |                            |                    |
     |<-------------------------------------|                            |                    |
     |  redirect customer's browser -------------------------------------------------------->|
     |                                       |    phone + OTP, pick wallet, confirm            |
     |                                       |<------------------------------------------------|
     |  POST callbackUrl (webhook)          |                            |                    |
     |<-------------------------------------|                            |                    |
     |                                       |  browser redirected back to callbackUrl -------->|
```

### Step 1 — create the charge

```
POST /transactions/purchase/charge
Authorization: Bearer <your merchant JWT>
Idempotency-Key: <uuid>

{
  "amount": 125000,          // minor units, positive integer
  "currencyCode": "USD",
  "language": "en",          // optional, "en" | "fa", defaults to "en" — what the pay page renders in
  "settlementSplits": [      // optional, overrides the wallet's default settlementAccounts for this charge only
    { "iban": "IR...", "label": "Main", "type": "PERCENT", "value": 100 }
  ]
}
```

- Your merchant wallet for `currencyCode` is resolved server-side — you don't
  pass a wallet id.
- If the wallet has `allowedIps` configured, the request must originate from
  one of them (checked via `Origin`/`Referer`/client IP).
- `settlementSplits` percentages must sum to exactly 100, or fixed amounts
  (minor units) must sum to exactly `amount`.

**Response:**

```json
{
  "transactionId": "uuid",
  "redirectUrl": "http://localhost:5174/pay/<authority>",
  "expiresAt": "2026-01-01T00:15:00.000Z"
}
```

### Step 2 — redirect the customer

Redirect the customer's browser to `redirectUrl`. Everything from here
happens on the IPG pay page, outside your system:

1. Pay page shows your `storeName`, amount, and a countdown to `expiresAt`.
2. Customer enters their phone number (+ a math captcha) and receives an OTP.
   In this sandbox build there's no SMS provider — the OTP is returned
   directly as `devCode` in the request-otp response for testing.
3. Customer enters the OTP and is shown their own wallets that can pay in
   your currency.
4. Customer picks a wallet and confirms.
   - If they pick a `CREDIT` wallet without enough available credit, the pay
     page walks them through a top-up (a real payment covering the
     shortfall) before the charge attaches — you don't need to handle this,
     it's entirely between the customer and their credit line.
5. IPG calls back into Packeta to verify and settle the transaction, then
   redirects the browser to your `callbackUrl` with
   `?transactionId=<id>&status=<COMPLETED|REVERSED>` appended (only when a
   credit top-up detour happened — a normal confirm keeps the customer on
   the IPG's own result page instead).

### Step 3 — receive the webhook (this is your real confirmation)

The moment the purchase resolves — independent of whether the customer's
browser ever makes it back to you — Packeta POSTs to your wallet's
`callbackUrl`:

```
POST https://mystore.example.com/webhooks/packeta
Content-Type: application/json

{ "transactionId": "uuid", "status": "COMPLETED", "amount": "125000" }
```

`status` is one of `PENDING | COMPLETED | REVERSED`. This call is
best-effort and fire-and-forget on Packeta's side (a failure to reach your
endpoint does not undo the transaction) — **treat it as a notification to
poll/confirm, not as the sole source of truth**. Verify the final state with
step 4 if you need certainty, and make your webhook handler idempotent
(you may receive it more than once, or not at all if your endpoint was
briefly down).

### Step 4 — (optional) confirm status yourself

```
GET /transactions/:id
Authorization: Bearer <your merchant JWT>
```

Returns the full transaction record including `status`, `amount`,
`fromWalletId`, `toWalletId`, `createdAt`. Poll this if you don't fully trust
the webhook, or use it to reconcile at the end of the day.

### Timeouts and cancellation

- A charge left unattended past `expiresAt` is automatically reversed by a
  background sweep — no action needed on your side.
- `POST /transactions/purchase/:id/verify` and
  `POST /transactions/purchase/:id/cancel` are public (no auth) and are what
  the IPG/pay page itself calls — you generally don't call these directly
  unless you're building a custom pay page against the `purchase-gateway`
  endpoints (see §6).

---

## 5. Accepting a payment — admin-issued charge

If you don't have (or don't want) a Packeta account, a Packeta admin can
create the charge for you:

1. Admin looks you up: `GET /admin/merchants/by-phone?phone=<your phone>` →
   your account + eligible wallets.
2. Admin creates the charge: `POST /admin/purchase/charge`
   `{ "walletId": "<your wallet id>", "amount": 125000, "language": "en" }`
   → same `{ transactionId, redirectUrl, expiresAt }` shape as §4.
3. From here it's identical to §4 steps 2–4 — redirect the customer,
   receive the webhook, optionally poll for status.

The only difference is *who* calls step 1 of §4 and that no IP/site checks
apply, since there's no self-service caller to validate.

---

## 6. Direct P2P purchase (both sides already have Packeta accounts)

If your customer is already logged into Packeta and paying a merchant they
already know (no IPG detour, no OTP):

```
POST /transactions/purchase/initiate
Authorization: Bearer <customer JWT>
Idempotency-Key: <uuid>

{ "fromWalletId": "<customer wallet>", "toEmail": "merchant@example.com", "amount": 125000 }

→ { "transactionId": "uuid", "redirectUrl": "...", "expiresAt": "..." }
```

The merchant's destination wallet is resolved server-side from their email
(their oldest eligible wallet for that currency) — you never see or choose
another user's wallet id.

Related endpoints with the same auth + `Idempotency-Key` pattern:

| Endpoint | Purpose |
|---|---|
| `POST /transactions/deposit` `{ walletId, amount }` | Top up your own wallet via the payment gateway |
| `POST /transactions/withdraw` `{ walletId, amount, railType }` | Pay real money out to a bank rail |
| `POST /transactions/transfer` `{ fromWalletId, toEmail, amount }` | P2P transfer, no gateway involved |
| `GET /transactions?walletId=` | Your own transaction history |
| `POST /transactions/:id/reverse` `{ reason }` | Reverse a transaction you're a party to |

---

## 7. Building a custom pay page (advanced)

The IPG pay page itself is built on a small set of **public, unauthenticated**
endpoints under `/purchase-gateway` — identity comes from phone + OTP scoped
to one `authority` (the `redirectUrl`'s path segment from §4/§5), not a
Packeta session. Use these directly only if you're replacing the pay page UI
entirely:

```
GET  /purchase-gateway/charge/:authority/status
     → { needsWalletSelection, merchantName, storeSite, terminalId, acceptorCode,
         category, subCategory, displayAmount, displayAmountFa,
         displayAmountWordsEn, displayAmountWordsFa, expiresAt, language }

GET  /purchase-gateway/captcha
     → { captchaId, image }

POST /purchase-gateway/otp/request
     { authority, phoneNumber, captchaId, captchaAnswer }
     → { devCode }

POST /purchase-gateway/otp/verify
     { authority, code }
     → { sessionToken, wallets: Wallet[] }   // customer's wallets eligible for this charge's currency

POST /purchase-gateway/attach-wallet
     { authority, sessionToken, walletId }
     → { transactionId }
     // or, if a CREDIT wallet can't fully cover the charge:
     → { transactionId, insufficientCredit: { shortfall, availableCredit } }

POST /purchase-gateway/support-topup
     { authority, sessionToken, walletId }
     → { redirectUrl }   // a real payment covering the shortfall reported above
```

After `attach-wallet` succeeds (no `insufficientCredit`), the transaction is
funded and ready — your custom UI should then call whatever confirm/cancel
action you build on top of `POST /transactions/purchase/:id/verify` /
`:id/cancel` (both public, and `verify`/`cancel` only ever act on `PENDING`
transactions, so they can't be used to tamper with a settled one).

---

## 8. Errors

Errors follow NestJS's default shape:

```json
{ "statusCode": 400, "message": "amount must not be less than 1", "error": "Bad Request" }
```

Common status codes you'll hit:

| Status | Meaning |
|---|---|
| 400 | Validation failure (see `message` for the specific field/rule) |
| 401 | Missing/expired JWT, or wrong OTP/password |
| 403 | Authenticated but not allowed to touch this resource (wrong wallet owner, IP not allowlisted, wallet blocked) |
| 404 | Wallet/transaction/user not found |
| 409 | Idempotency key conflict (§3), or a business-rule conflict (e.g. insufficient balance) |
| 422 | Request is well-formed but violates a business rule (e.g. amount exceeds the wallet's credit line) |

---

## 9. Reference

### TransactionStatus
`PENDING | COMPLETED | REVERSED`

### TransactionType
`DEPOSIT | WITHDRAW | TRANSFER | ADJUSTMENT | PURCHASE | VIRTUAL`
(`VIRTUAL` is an internal credit-ceiling bookkeeping entry — you'll never
create one directly.)

### Going-live checklist

- [ ] Merchant wallet created with `allowPurchaseIn: true` for every
      currency you accept
- [ ] `callbackUrl` set, `https://`, and your endpoint is idempotent
      (may receive the same webhook more than once)
- [ ] `allowedIps` set if you're calling `purchase/charge` from a fixed
      server (recommended)
- [ ] You're storing amounts as integers/`BigInt` in minor units, never
      floats
- [ ] Every state-changing call sends a fresh `Idempotency-Key`, reused
      only on retry of the exact same request
- [ ] You handle `expiresAt` client-side (don't show a stale "pay now"
      link past that time) — the server-side sweep handles the actual
      reversal
- [ ] You have a reconciliation path (`GET /transactions/:id`) independent
      of the webhook, for the case where it never arrives
