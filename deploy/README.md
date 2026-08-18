# Deploying to packeta.ir / pay.packeta.ir

Two public domains, each pairing a frontend with its backend under `/api`:

| Domain            | Serves                            | `/api` proxies to        |
|-------------------|------------------------------------|---------------------------|
| `packeta.ir`      | `frontend` (wallet app)            | `backend`                 |
| `pay.packeta.ir`  | `ipg-frontend` (pay page/widgets)  | `ipg-backend`             |

Neither backend has a built-in `/api` prefix (see `backend/src/main.ts`,
`ipg-backend/src/main.ts`) — the `/api` prefix exists only in nginx, which
strips it before proxying. There are two ways to run this; pick one.

## Option A — Docker Compose (recommended)

`docker-compose.yml` already wires up nginx + both domains: an `nginx`
container is the only thing published to the host (ports 80/443), and it
reverse-proxies to the `frontend`/`backend`/`ipg-frontend`/`ipg-backend`
containers by service name over the internal compose network — none of
those publish ports directly anymore.

### 1. DNS

Point both `packeta.ir` and `pay.packeta.ir` A/AAAA records at the server.

### 2. (Optional) override the domains

Defaults are `packeta.ir` / `pay.packeta.ir`. To deploy elsewhere, put this
in a `.env` file at the repo root instead of editing `docker-compose.yml`:

```
WALLET_DOMAIN=packeta.ir
PAY_DOMAIN=pay.packeta.ir
```

Also set real secrets there for a public deployment — `JWT_SECRET`,
`ZARINPAL_MERCHANT_ID`, `MONGO_EXPRESS_USERNAME`/`PASSWORD` — see the
`${VAR:-default}` fallbacks in `docker-compose.yml`.

### 3. First-time TLS

```bash
LETSENCRYPT_EMAIL=you@example.com ./deploy/docker/init-letsencrypt.sh
```

This issues real Let's Encrypt certs for both domains (see the script's
header comment for why it needs a dummy-cert bootstrap step first) and
starts nginx. Set `STAGING=1` on the first run if you want to test against
Let's Encrypt's staging CA (no rate limits, untrusted cert) before doing it
for real.

### 4. Bring up everything else

```bash
docker compose up -d --build
```

`--build` matters here specifically for the frontends: Vite bakes
`VITE_API_URL`/`VITE_PACKETA_API_URL` into the bundle at *build* time from
`WALLET_DOMAIN`/`PAY_DOMAIN`, so a plain restart won't pick up a domain
change — only a rebuild will.

### 5. Renewing certs

Let's Encrypt certs expire after 90 days. Nothing in this repo auto-renews
them (a background renewal loop can't reload nginx without extra
docker-socket access, which isn't worth the complexity here) — instead, add
this to the host's crontab:

```cron
0 3 * * * cd /path/to/Packeta && docker compose run --rm certbot renew --webroot -w /var/www/certbot -q && docker compose exec nginx nginx -s reload
```

## Option B — Bare metal (host nginx + systemd)

If you'd rather run nginx and the two Nest backends directly on the host
instead of in Docker:

1. **Build the frontends** with the right API URLs baked in (Vite inlines
   `VITE_*` at build time):

   ```bash
   cd frontend
   VITE_API_URL=https://packeta.ir/api npm ci && npm run build

   cd ../ipg-frontend
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

2. **Run the two backends** as systemd services. Configure each `.env` (see
   `backend/.env.example`, `ipg-backend/.env.example`) with production DB
   credentials and the browser-facing URLs:

   ```
   # backend/.env
   PORT=3000
   FRONTEND_URL=https://packeta.ir
   IPG_FRONTEND_URL=https://pay.packeta.ir
   IPG_BASE_URL=http://127.0.0.1:4000

   # ipg-backend/.env
   PORT=4000
   IPG_FRONTEND_URL=https://pay.packeta.ir
   ```

   ```bash
   cd backend && npm ci && npm run build
   cd ../ipg-backend && npm ci && npm run build

   sudo cp deploy/systemd/packeta-backend.service /etc/systemd/system/
   sudo cp deploy/systemd/packeta-ipg-backend.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now packeta-backend packeta-ipg-backend
   ```

   Both backends should listen on `127.0.0.1` only (or be firewalled to
   loopback) — nginx is meant to be the only public entry point.

3. **nginx**:

   ```bash
   sudo cp deploy/nginx/packeta.ir.conf /etc/nginx/sites-available/
   sudo cp deploy/nginx/pay.packeta.ir.conf /etc/nginx/sites-available/
   sudo ln -s /etc/nginx/sites-available/packeta.ir.conf /etc/nginx/sites-enabled/
   sudo ln -s /etc/nginx/sites-available/pay.packeta.ir.conf /etc/nginx/sites-enabled/
   sudo mkdir -p /var/www/certbot
   sudo nginx -t && sudo systemctl reload nginx
   ```

4. **TLS**: the configs assume certs already exist at
   `/etc/letsencrypt/live/<domain>/`:

   ```bash
   sudo certbot certonly --webroot -w /var/www/certbot -d packeta.ir
   sudo certbot certonly --webroot -w /var/www/certbot -d pay.packeta.ir
   sudo systemctl reload nginx
   ```

   Certbot's installed timer renews both automatically.

## Notes (apply to both options)

- **CORS**: `pay.packeta.ir`'s frontend calls `packeta.ir/api` directly
  (cross-origin). Both backends already call `app.enableCors()` with no
  origin restriction, so this works out of the box — tighten it to specific
  origins in `main.ts` if you want to lock that down later.
- **Uploads**: avatar/document uploads are served by the backend itself at
  `/uploads/*` (see `ServeStaticModule` in `backend/src/app.module.ts`), not
  by nginx — they arrive at the client as `/api/uploads/...` through the
  same `/api/` proxy location, so no separate nginx rule is needed.
- **File size**: both nginx configs set `client_max_body_size 10m`; the
  backend itself caps individual uploads at 5 MB (`MAX_UPLOAD_BYTES` /
  `MAX_AVATAR_BYTES`).
- **SPA routing**: both frontends use Vue Router in `history` mode. The
  Docker path proxies to `vite preview`, which already serves the SPA
  fallback itself; the bare-metal configs do it with `try_files ... /index.html`.
