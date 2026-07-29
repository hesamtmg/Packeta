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
| POST   | `/transactions/purchase/:id/verify` | ✅ | called after the IPG callback; verifies with the IPG and, on success, moves the money and marks `COMPLETED` |
| POST   | `/transactions/:id/reverse` | ✅ | `{ reason? }` + `Idempotency-Key` header → cancels a `PENDING` purchase or refunds a `COMPLETED` one (caller must own either wallet) |
| GET    | `/transactions`           | ✅   | transaction history across all of the current user's wallets (optionally `?walletId=` to filter to one) |
| GET    | `/transactions/:id`       | ✅   | full detail for one transaction (type, amount, from/to wallet + currency, note, idempotency key, purchase `status`/`expiresAt`) — must touch one of the caller's own wallets |
| GET    | `/users/me`               | ✅   | the current user's id, email, and role                              |
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

## Tests

```
cd backend
npm test
```

```
cd ipg-backend
npm test
```
