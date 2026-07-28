# Packeta

A single-currency wallet app.

- **Backend**: NestJS + TypeORM (`backend/`)
- **Primary DB**: PostgreSQL — users, wallets, ledger of transactions, idempotency keys
- **Log DB**: MongoDB — audit/activity log stream (auth + transaction attempts and outcomes)
- **Frontend**: Vue 3 + Vite + Pinia (`frontend/`)

## Architecture

- **Balance model**: each wallet has a cached `balance` (bigint, minor units e.g. cents), guarded by a
  `CHECK (balance >= 0)` constraint. The `transactions` table is an append-only ledger of every completed
  money movement (deposit/withdraw/transfer). Every mutation locks the affected wallet row(s) with
  `SELECT ... FOR UPDATE` inside a single DB transaction before updating the balance and inserting the
  ledger row.
- **Transfers**: debit and credit happen in one DB transaction. The two wallets involved are always locked
  in ascending wallet-id order, regardless of transfer direction, so two concurrent transfers between the
  same pair of wallets can't deadlock.
- **Idempotency**: every deposit/withdraw/transfer call requires an `Idempotency-Key` header. The key is
  claimed (inserted `IN_PROGRESS`) in the same DB transaction as the wallet mutation, using the key's unique
  constraint to serialize concurrent duplicates. A repeated request with the same key and payload replays
  the original response instead of reprocessing; the same key with a different payload is rejected (409).
- **Auth**: email/password with bcrypt hashing, JWT access tokens (no refresh flow yet).
- **Audit log**: every auth and transaction attempt (success or failure) is written to MongoDB. Mongo is
  never authoritative for financial state — a logging failure is caught and does not affect the
  already-committed Postgres transaction.

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

| Method | Path                  | Auth | Notes                                            |
| ------ | --------------------- | ---- | ------------------------------------------------- |
| POST   | `/auth/signup`        | —    | `{ email, password }` → creates user + wallet     |
| POST   | `/auth/login`         | —    | `{ email, password }`                             |
| GET    | `/wallets/me`         | ✅   | current wallet balance                            |
| POST   | `/transactions/deposit`  | ✅ | `{ amount }` (minor units) + `Idempotency-Key` header |
| POST   | `/transactions/withdraw` | ✅ | `{ amount }` + `Idempotency-Key` header               |
| POST   | `/transactions/transfer` | ✅ | `{ toEmail, amount }` + `Idempotency-Key` header      |
| GET    | `/transactions`       | ✅   | transaction history for the current wallet        |

## Tests

```
cd backend
npm test
```
