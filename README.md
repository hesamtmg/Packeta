# Packeta

A multi-wallet app.

- **Backend**: NestJS + TypeORM (`backend/`)
- **Primary DB**: PostgreSQL — users, wallet types, wallets, ledger of transactions, idempotency keys
- **Log DB**: MongoDB — audit/activity log stream (auth + transaction attempts and outcomes)
- **Frontend**: Vue 3 + Vite + Pinia (`frontend/`)

## Architecture

- **Wallet types are data, not an enum**: the `wallet_types` table holds the "laws" governing each type —
  `allowNegativeBalance`, `creditLimit`, `allowWithdraw`, `allowP2pOut`, `allowP2pIn`. Seeded with four
  types: **Buy** (general spending, can send/receive peer-to-peer), **Sell** (earnings, no P2P),
  **Credit** (a real credit line — can go negative down to `-creditLimit`, e.g. a cash advance), and
  **Gift** (spend-only — no withdrawals, no P2P in or out).
- **Multiple wallets per user**: a user can hold several wallets of the same type. Every new user gets one
  wallet of each known type on signup and can create more of any type afterwards (`POST /wallets`).
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
  takes effect immediately. Admins can manage the `wallet_types` table itself (create new types, edit an
  existing type's rules), look up any user and their wallets/transaction history, and make manual balance
  adjustments. An adjustment is its own ledger entry (`ADJUSTMENT`) recording the admin's reason and who
  performed it, still bounded by the wallet's own balance floor — admins can correct balances, not bypass
  the wallet type's fundamental rules. There's no UI for granting the *first* admin (that would be a
  privilege-escalation hole); use the `promote-admin` script instead.

## Running locally

### 1. Start Postgres + Mongo

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

## API

All endpoints are JSON. Authenticated endpoints require `Authorization: Bearer <token>`.

| Method | Path                      | Auth | Notes                                                              |
| ------ | ------------------------- | ---- | ------------------------------------------------------------------- |
| POST   | `/auth/signup`            | —    | `{ email, password }` → creates user + one wallet of each type      |
| POST   | `/auth/login`             | —    | `{ email, password }`                                                |
| GET    | `/wallet-types`           | ✅   | list of wallet types and the rules ("laws") each one enforces        |
| GET    | `/wallets`                | ✅   | list the current user's wallets                                     |
| GET    | `/wallets/:id`            | ✅   | a specific wallet (must belong to the caller)                       |
| POST   | `/wallets`                | ✅   | `{ walletTypeCode }` → create another wallet of that type            |
| POST   | `/transactions/deposit`   | ✅   | `{ walletId, amount }` (minor units) + `Idempotency-Key` header      |
| POST   | `/transactions/withdraw`  | ✅   | `{ walletId, amount }` + `Idempotency-Key` header (blocked if the wallet type disallows withdrawals) |
| POST   | `/transactions/transfer`  | ✅   | `{ fromWalletId, toEmail, amount }` + `Idempotency-Key` header (both wallets' types must allow peer-to-peer) |
| GET    | `/transactions`           | ✅   | transaction history across all of the current user's wallets (optionally `?walletId=` to filter to one) |
| GET    | `/users/me`               | ✅   | the current user's id, email, and role                              |
| POST   | `/wallet-types`           | 🔒 admin | `{ code, name, allowNegativeBalance, creditLimit?, allowWithdraw, allowP2pOut, allowP2pIn }` → create a new wallet type |
| PATCH  | `/wallet-types/:id`       | 🔒 admin | partial update of a wallet type's rules                              |
| GET    | `/admin/users`            | 🔒 admin | list all users                                                       |
| GET    | `/admin/users/:id`        | 🔒 admin | a user's profile + all of their wallets                              |
| GET    | `/admin/users/:id/transactions` | 🔒 admin | that user's full transaction history                           |
| POST   | `/admin/wallets/:id/adjust` | 🔒 admin | `{ amount, reason }` (signed minor units) + `Idempotency-Key` header → manual balance correction |

## Tests

```
cd backend
npm test
```
