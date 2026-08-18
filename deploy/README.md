# Deploying to packeta.ir / pay.packeta.ir

Two public domains, each pairing a static frontend with its backend under `/api`:

| Domain             | Serves                          | `/api` proxies to      |
|---------------------|----------------------------------|-------------------------|
| `packeta.ir`         | `frontend` (wallet app)          | `backend` on `:3000`    |
| `pay.packeta.ir`     | `ipg-frontend` (pay page/widgets)| `ipg-backend` on `:4000`|

Both backends are plain NestJS apps with no `/api` prefix of their own
(`backend/src/main.ts`, `ipg-backend/src/main.ts`) — the `/api` prefix exists
only in nginx, which strips it before proxying. This also means the backends
should **not** be exposed directly on the public interface; nginx is the only
public entry point, and the backends should listen on `127.0.0.1` (or be
firewalled to loopback) once this is in place.

## 1. DNS

Point both `packeta.ir` and `pay.packeta.ir` A/AAAA records at the server.

## 2. Build the frontends with the right API URLs

Vite bakes `VITE_*` values into the bundle at build time, so this has to be
set correctly before `npm run build`:

```bash
# frontend (wallet app)
cd frontend
VITE_API_URL=https://packeta.ir/api npm ci && npm run build

# ipg-frontend (pay page) — also calls Packeta's own backend directly
# (phone+OTP identification, wallet selection on a merchant charge)
cd ipg-frontend
VITE_API_URL=https://pay.packeta.ir/api \
VITE_PACKETA_API_URL=https://packeta.ir/api \
npm ci && npm run build
```

Copy the output to where nginx serves it:

```bash
sudo mkdir -p /var/www/packeta/frontend /var/www/packeta/ipg-frontend
sudo cp -r frontend/dist/. /var/www/packeta/frontend/
sudo cp -r ipg-frontend/dist/. /var/www/packeta/ipg-frontend/
```

Re-run the build + copy any time `VITE_*` values or frontend code change —
container/service restarts alone won't pick up new `VITE_*` values.

## 3. Run the two backends

Build each and configure its `.env` (see `backend/.env.example`,
`ipg-backend/.env.example`) with production DB credentials and, importantly,
the browser-facing URLs so redirects and callback links point at the real
domains instead of localhost:

```
# backend/.env
PORT=3000
FRONTEND_URL=https://packeta.ir
IPG_FRONTEND_URL=https://pay.packeta.ir
IPG_BASE_URL=http://127.0.0.1:4000   # server-to-server, stays internal

# ipg-backend/.env
PORT=4000
IPG_FRONTEND_URL=https://pay.packeta.ir
```

Then build and install the systemd units in `deploy/systemd/` (adjust
`WorkingDirectory`/`User` if your paths differ):

```bash
cd backend && npm ci && npm run build
cd ../ipg-backend && npm ci && npm run build

sudo cp deploy/systemd/packeta-backend.service /etc/systemd/system/
sudo cp deploy/systemd/packeta-ipg-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now packeta-backend packeta-ipg-backend
```

## 4. nginx

```bash
sudo cp deploy/nginx/packeta.ir.conf /etc/nginx/sites-available/
sudo cp deploy/nginx/pay.packeta.ir.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/packeta.ir.conf /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/pay.packeta.ir.conf /etc/nginx/sites-enabled/
sudo mkdir -p /var/www/certbot
sudo nginx -t && sudo systemctl reload nginx
```

## 5. TLS (Let's Encrypt)

The provided configs assume certs already exist at
`/etc/letsencrypt/live/<domain>/`. Issue them with certbot's webroot plugin
(matches the `/.well-known/acme-challenge/` location in both configs):

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d packeta.ir -d www.packeta.ir
sudo certbot certonly --webroot -w /var/www/certbot -d pay.packeta.ir
sudo systemctl reload nginx
```

Certbot's installed timer renews both automatically.

## Notes

- **CORS**: `pay.packeta.ir`'s frontend calls `packeta.ir/api` directly
  (cross-origin). Both backends already call `app.enableCors()` with no
  origin restriction, so this works out of the box — tighten it to specific
  origins in `main.ts` if you want to lock that down later.
- **Uploads**: avatar/document uploads are served by the backend itself at
  `/uploads/*` (see `ServeStaticModule` in `backend/src/app.module.ts`), not
  by nginx — they arrive at the client as `/api/uploads/...` through the same
  `/api/` proxy location, so no separate nginx rule is needed.
- **File size**: both configs set `client_max_body_size 10m`; the backend
  itself caps individual uploads at 5 MB (`MAX_UPLOAD_BYTES` /
  `MAX_AVATAR_BYTES`).
- **SPA routing**: both frontends use Vue Router in `history` mode, so each
  config falls back unknown paths to `index.html`.
