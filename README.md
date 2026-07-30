# Packeta

A multi-wallet app, plus a standalone sandbox payment gateway (IPG) it settles merchant purchases through.

- **Backend**: NestJS + TypeORM (`backend/`)
- **Primary DB**: PostgreSQL — users, wallet types, wallets, ledger of transactions, idempotency keys
- **Log DB**: MongoDB — audit/activity log stream (auth + transaction attempts and outcomes)
- **Frontend**: Vue 3 + Vite + Pinia (`frontend/`)
- **IPG backend**: NestJS + TypeORM, its own Postgres database (`ipg-backend/`) — a sandbox payment gateway
  simulator, entirely separate from Packeta's own ledger
- **IPG frontend**: Vue 3 + Vite (`ipg-frontend/`) — the customer-facing payment confirmation page

## Architecture

- **Wallet types are data, not an enum**: the `wallet_types` table holds the "laws" governing each type —
  `allowNegativeBalance`, `creditLimit`, `allowWithdraw`, `allowP2pOut`, `allowP2pIn`. Seeded with four
  types: **Buy** (general spending, can send/receive peer-to-peer), **Sell** (earnings, no P2P),
  **Credit** (a real credit line — can go negative down to `-creditLimit`, e.g. a cash advance), and
  **Gift** (spend-only — no withdrawals, no P2P in or out).
- **Currencies are data too, and a wallet type is denominated in exactly one**: the `currencies` table
  holds each currency's `decimalPlaces` and display `symbol`/`symbolPosition` (USD: 2 places, `$` prefix;
  IRR: 0 places, `IRR` suffix — Rial isn't shown with subdivisions the way dollars are). A wallet type is
  paired with a currency (e.g. "Credit" has a separate USD row and a separate IRR row) rather than a wallet
  carrying its own currency field, because `creditLimit` is a flat number that only means something in one
  currency's scale. Seeded with USD (the default currency) and IRR, each with all four wallet types.
  Transfers only work between wallets holding the *same* currency — there's no exchange-rate conversion.
- **Multiple wallets per user**: a user can hold several wallets of the same type (and, since type is paired
  with currency, of the same currency). Every new user gets one wallet of each type denominated in the
  *default* currency on signup; adding a new currency later never expands what existing or new users get by
  default. Users can create more wallets of any type/currency combination afterwards (`POST /wallets`).
- **Balance model**: each wallet has a cached `balance` (bigint, minor units e.g. cents). The floor a
  balance can't go below (`0`, or `-creditLimit` for types that allow going negative) depends on the
  wallet's type, so it's enforced by a Postgres trigger that joins `wallet_types` — a plain `CHECK`
  constraint can't reference another table. The `transactions` table is an append-only ledger of every
  completed money movement. Every mutation locks the affected wallet row(s) with `SELECT ... FOR UPDATE`
  inside a single DB transaction before updating the balance and inserting the ledger row.
- **Transfers are peer-to-peer between wallets whose type allows it** (only Buy, by default): the sender
  picks which of their own eligible wallets to send from; the recipient is identified by email and their
  destination wallet is resolved automatically to their oldest eligible wallet — the sender never sees or
  picks a specific wallet ID belonging to someone else. The two wallets involved are always locked in
  ascending wallet-id order, regardless of transfer direction, so two concurrent transfers between the same
  pair of wallets can't deadlock.
- **Merchant wallets and purchases**: a `MERCHANT` wallet type (seeded per-currency, opt-in via `POST /wallets`
  rather than part of the default starter set — see `isStarterType` below) can receive `PURCHASE`s from `BUY`
  wallets. A purchase is a real two-phase, IPG-style payment, not an instant transfer:
  1. **Initiate** (`POST /transactions/purchase/initiate`): Packeta creates a `PENDING` ledger row (no balance
     change yet) and calls out to the separate IPG (`ipg-backend/`) to create a payment intent, returning a
     `redirectUrl` to the IPG's pay page (`ipg-frontend/`).
  2. **Customer confirms or cancels** on the IPG's own page — a plain confirmation simulator with no real
     bank accounts or balances of its own. It redirects the browser back to Packeta's callback URL
     (`/purchase/:id/callback`) with the outcome.
  3. **Verify** (`POST /transactions/purchase/:id/verify`): on a successful callback, Packeta calls the IPG's
     one-time verify endpoint server-to-server; only once that succeeds does real money move — debiting the
     customer and crediting the merchant atomically, and the transaction becomes `COMPLETED`. A canceled
     callback instead reverses the (still-`PENDING`, fund-less) purchase directly.
  4. **Timeout**: each merchant wallet configures its own `purchaseTimeoutSeconds` at creation (default 15
     minutes). A scheduled sweep (every 30s) marks any `PENDING` purchase past that deadline `REVERSED` —
     nothing to unwind financially, since funds never moved before verification.
  5. **Refund** (`POST /transactions/:id/reverse`): a `COMPLETED` purchase can be refunded afterwards —
     credits the customer back, debits the merchant, and records the reversal as its own linked ledger row
     (`relatedTransactionId`) rather than rewriting history.

  Merchant wallets can also configure up to 3 daily `autoWithdrawTimes` ("HH:MM", server-local) at which
  their full balance auto-sweeps out as a plain `WITHDRAW`, via the same scheduler.

  `isStarterType` on `wallet_types` controls whether a type is part of every new signup's default set (only
  the original four are); this also fixed a latent bug where any custom type created in the default currency
  was silently being granted to every new signup.
- **Merchant-initiated checkout (phone + OTP, no Packeta session required)**: `POST /transactions/purchase/charge`
  lets a merchant create a payment link naming only an amount and currency — no customer or wallet is chosen
  yet, unlike `purchase/initiate`. The merchant hands that link to a customer who may have no Packeta account
  open on that device at all:
  1. The customer opens the IPG pay page, which first checks (`GET /purchase-gateway/charge/:authority/status`)
     whether this authority still needs a wallet. If so, it shows a phone number field instead of the amount.
  2. **`POST /purchase-gateway/otp/request`** looks up the phone number against `users.phoneNumber` (set via
     `PATCH /users/me/phone-number`) and generates a one-time code — sandboxed, so there's no real SMS
     provider, and the code is simply returned in the response instead of being texted.
  3. **`POST /purchase-gateway/otp/verify`** checks the code (one-time use, 5-minute expiry) and, on success,
     returns every wallet that account holds which is eligible to pay this merchant (`allowPurchaseOut` +
     matching currency) along with a short-lived `sessionToken`.
  4. **`POST /purchase-gateway/attach-wallet`** binds the customer's chosen wallet to the charge (only once,
     only via that session token) — from here on it behaves exactly like a normal purchase: confirm/cancel on
     the IPG, server-to-server verify, timeout, refund.

  These three `purchase-gateway` endpoints, plus `purchase/:id/verify` and `purchase/:id/cancel`, are
  intentionally unauthenticated — the customer using them may have no Packeta session at all. Safety instead
  comes from each step's own scoping: OTPs are one-time-use and tied to one specific charge, `attach-wallet`
  requires a session token that only exists after a successful OTP check, `verify` only ever moves money into
  the wallet that step already fixed, and `cancel` only ever touches a still-`PENDING` purchase.
- **IPG pay page UX**: `GET /purchase-gateway/charge/:authority/status` returns everything the pay page's
  header needs (`merchantName`, `displayAmount`, `expiresAt`), so a merchant-info banner with a live countdown
  renders identically across every step — phone, OTP, wallet selection, and the final confirm screen — not
  just at the end. The countdown reflects the merchant wallet's own configured `purchaseTimeoutSeconds`, so a
  shorter or longer timeout set at wallet creation is immediately visible to the customer, and turns red under
  a minute left. The phone-number step is guarded by a self-hosted math CAPTCHA (`GET /purchase-gateway/captcha`,
  answer required by `otp/request`) — an in-memory, one-time-use challenge with no external provider, meant as
  a lightweight deterrent against scripted OTP-request abuse rather than a hardened bot defense. Once OTP
  verification returns the customer's eligible wallets, they're presented as a horizontally-swipeable card
  carousel instead of a plain list. After confirming or canceling on the IPG, the customer no longer jumps
  straight to the merchant's callback URL — they land on a redirect-confirmation interstitial showing the
  destination and a short countdown, with a "Continue now" button to skip the wait, so the handoff can
  actually be inspected instead of happening instantly.
- **Localization (English + Farsi)**: both `frontend` and `ipg-frontend` are localized with `vue-i18n`, each
  with its own `en`/`fa` message files under `src/i18n/`. A language switcher (persisted to `localStorage`)
  is available on every customer and admin page; switching to Farsi flips `<html dir>` to `rtl` as well as
  swapping text, since Persian reads right-to-left — Vue's flex-based layouts mirror automatically. The IPG
  pay page doesn't have its own login/session to remember a preference from, so it's driven differently: a
  merchant creating a charge (`POST /transactions/purchase/charge`) can pass an optional `language: 'en' | 'fa'`
  field, stored on the `PURCHASE` transaction and returned by the enriched
  `GET /purchase-gateway/charge/:authority/status` endpoint, so the pay page auto-selects the right language
  and direction before the customer sees anything — with a manual toggle in its nav bar as a fallback/override.
- **Idempotency**: every deposit/withdraw/transfer call requires an `Idempotency-Key` header. The key is
  claimed (inserted `IN_PROGRESS`) in the same DB transaction as the wallet mutation, using the key's unique
  constraint (and a savepoint, so a conflicting insert doesn't abort the rest of the transaction) to
  serialize concurrent duplicates. A repeated request with the same key and payload replays the original
  response instead of reprocessing; the same key with a different payload is rejected (409).
- **Auth**: email/password with bcrypt hashing, JWT access tokens (no refresh flow yet).
- **Audit log**: every auth and transaction attempt (success or failure) is written to MongoDB. Mongo is
  never authoritative for financial state — a logging failure is caught and does not affect the
  already-committed Postgres transaction.
- **Admin panel**: users have a `role` (`USER`/`ADMIN`). `AdminGuard` re-checks the caller's role against the
  DB on every admin request (rather than trusting a claim baked into the JWT), so revoking admin access
  takes effect immediately. There's no UI for granting the *first* admin (that would be a
  privilege-escalation hole); use the `promote-admin` script instead — after that, admins can promote/demote
  other users from the panel itself. Balance adjustments are their own ledger entry (`ADJUSTMENT`) recording
  the admin's reason and who performed it, still bounded by the wallet's own balance floor — admins can
  correct balances, not bypass a wallet type's fundamental rules.

  The panel (`/admin`) is a dark dashboard-style UI with a sidebar: **Dashboard** (KPI tiles, a signups
  chart, latest transaction, recent activity table), **Transactions** (every transaction system-wide,
  filterable by type), **Wallets** (every wallet system-wide, searchable, with inline balance adjustment),
  **Customers** (`role: USER` accounts — drill into one to see its wallets, adjust balances, and view its
  history), **Admins** (promote a customer / demote an admin — you can't demote yourself), **Wallet Types**
  (the existing type/currency rule editor), and **Reports** (30-day activity chart, breakdowns by
  transaction type and wallet type, most-active customers).

## Running locally

### 1. Start Postgres + Mongo (+ the IPG's own Postgres)

```
docker compose up -d
```

### 2. Backend

```
cd backend
cp .env.example .env
npm install
npm run migration:run
npm run start:dev
```

API listens on `http://localhost:3000`.

To make a user an admin (there's no self-service way to do this):

```
npm run promote-admin -- someone@example.com
```

### 3. Frontend

```
cd frontend
cp .env.example .env
npm install
npm run dev
```

UI on `http://localhost:5173`.

### 4. IPG backend (sandbox payment gateway)

```
cd ipg-backend
cp .env.example .env
npm install
npm run migration:run
npm run start:dev
```

API listens on `http://localhost:4000`. Packeta's backend calls this over HTTP for purchase
initiate/verify — set `IPG_BASE_URL`/`IPG_API_KEY` in `backend/.env` to match.

### 5. IPG frontend (payment page)

```
cd ipg-frontend
cp .env.example .env
npm install
npm run dev
```

UI on `http://localhost:5174` — this is where a customer lands after starting a purchase.

## API

All endpoints are JSON. Authenticated endpoints require `Authorization: Bearer <token>`.

| Method | Path                      | Auth | Notes                                                              |
| ------ | ------------------------- | ---- | ------------------------------------------------------------------- |
| POST   | `/auth/signup`            | —    | `{ email, password }` → creates user + one wallet of each type in the default currency |
| POST   | `/auth/login`             | —    | `{ email, password }`                                                |
| GET    | `/currencies`             | ✅   | list of currencies and their display/decimal rules                   |
| GET    | `/wallet-types`           | ✅   | list of wallet types (each denominated in one currency) and the rules ("laws") each one enforces |
| GET    | `/wallets`                | ✅   | list the current user's wallets                                     |
| GET    | `/wallets/:id`            | ✅   | a specific wallet (must belong to the caller)                       |
| POST   | `/wallets`                | ✅   | `{ walletTypeId, autoWithdrawTimes?, purchaseTimeoutSeconds? }` → create another wallet of that type/currency (the last two only apply to types that support them) |
| POST   | `/transactions/deposit`   | ✅   | `{ walletId, amount }` (minor units) + `Idempotency-Key` header      |
| POST   | `/transactions/withdraw`  | ✅   | `{ walletId, amount }` + `Idempotency-Key` header (blocked if the wallet type disallows withdrawals) |
| POST   | `/transactions/transfer`  | ✅   | `{ fromWalletId, toEmail, amount }` + `Idempotency-Key` header (both wallets' types must allow peer-to-peer) |
| POST   | `/transactions/purchase/initiate` | ✅ | `{ fromWalletId, toEmail, amount }` + `Idempotency-Key` header → creates a `PENDING` purchase and returns `{ transactionId, redirectUrl, expiresAt }` to send the customer to the IPG |
| POST   | `/transactions/purchase/charge` | ✅ | `{ amount, currencyCode }` + `Idempotency-Key` header → merchant-only "checkout link", no customer/wallet chosen yet; returns `{ transactionId, redirectUrl, expiresAt }` |
| POST   | `/transactions/purchase/:id/verify` | — | public; called after the IPG callback; verifies with the IPG and, on success, moves the money and marks `COMPLETED` |
| POST   | `/transactions/purchase/:id/cancel` | — | public; cancels a still-`PENDING` purchase (no funds to unwind) — used when the customer cancels on the IPG page |
| POST   | `/transactions/:id/reverse` | ✅ | `{ reason? }` + `Idempotency-Key` header → refunds a `COMPLETED` purchase (caller must own either wallet) |
| GET    | `/transactions`           | ✅   | transaction history across all of the current user's wallets (optionally `?walletId=` to filter to one) |
| GET    | `/transactions/:id`       | ✅   | full detail for one transaction (type, amount, from/to wallet + currency, note, idempotency key, purchase `status`/`expiresAt`) — must touch one of the caller's own wallets |
| GET    | `/users/me`               | ✅   | the current user's id, email, role, and phone number                |
| PATCH  | `/users/me/phone-number`  | ✅   | `{ phoneNumber }` → set/update the phone number used for the purchase gateway's OTP step |
| POST   | `/wallet-types`           | 🔒 admin | `{ code, name, currencyCode, allowNegativeBalance, creditLimit?, allowWithdraw, allowP2pOut, allowP2pIn, supportsAutoWithdraw?, allowPurchaseOut?, allowPurchaseIn? }` → create a new wallet type |
| PATCH  | `/wallet-types/:id`       | 🔒 admin | partial update of a wallet type's rules (currency can't be changed after creation) |
| GET    | `/admin/users`            | 🔒 admin | list all users                                                       |
| GET    | `/admin/users/:id`        | 🔒 admin | a user's profile + all of their wallets                              |
| PATCH  | `/admin/users/:id/role`   | 🔒 admin | `{ role: "USER" \| "ADMIN" }` → promote/demote (can't target yourself) |
| GET    | `/admin/users/:id/transactions` | 🔒 admin | that user's full transaction history                           |
| GET    | `/admin/wallets`          | 🔒 admin | every wallet system-wide, each with its owner's email                |
| GET    | `/admin/transactions`     | 🔒 admin | every transaction system-wide, most recent first (`?limit=`)         |
| POST   | `/admin/wallets/:id/adjust` | 🔒 admin | `{ amount, reason }` (signed minor units) + `Idempotency-Key` header → manual balance correction |

### IPG API (`ipg-backend/`, port 4000)

No user auth — merchant-facing endpoints instead require an `X-IPG-Api-Key` header (shared secret).

| Method | Path                          | Notes                                                              |
| ------ | ----------------------------- | ------------------------------------------------------------------- |
| POST   | `/payments`                   | 🔑 `{ merchantName, amount, displayAmount, callbackUrl, timeoutSeconds? }` → `{ authority, paymentUrl }` |
| GET    | `/payments/:authority`        | public info for the pay page: merchant, display amount, status, expiry |
| POST   | `/payments/:authority/confirm`| customer confirms → `{ redirectUrl }` back to the merchant's callback  |
| POST   | `/payments/:authority/cancel` | customer cancels → `{ redirectUrl }`                                 |
| POST   | `/payments/:authority/verify` | 🔑 one-time server-to-server confirmation, optionally cross-checking `{ amount }` |

### Purchase gateway API (`backend/`, part of Packeta's own backend)

Unauthenticated by design — see the architecture note above for why that's safe. Called directly by
`ipg-frontend`, not through `ipg-backend`.

| Method | Path                                     | Notes                                                    |
| ------ | ----------------------------------------- | --------------------------------------------------------- |
| GET    | `/purchase-gateway/charge/:authority/status` | `{ needsWalletSelection }` — whether the IPG pay page should show the phone/OTP/wallet steps |
| POST   | `/purchase-gateway/otp/request`           | `{ authority, phoneNumber }` → `{ devCode }` (sandbox: the code is returned directly, not texted) |
| POST   | `/purchase-gateway/otp/verify`            | `{ authority, code }` → `{ sessionToken, wallets }` — the phone owner's wallets eligible to pay this merchant |
| POST   | `/purchase-gateway/attach-wallet`         | `{ authority, sessionToken, walletId }` → binds that wallet to the charge as `fromWalletId` |

## Tests

```
cd backend
npm test
```

```
cd ipg-backend
npm test
```
