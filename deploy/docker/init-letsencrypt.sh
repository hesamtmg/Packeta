#!/usr/bin/env bash
# One-time bootstrap for TLS certs on a fresh server. Run this ONCE from the
# repo root, after DNS for both domains already points at this machine and
# ports 80/443 are reachable from the internet. Safe to re-run — every step
# is idempotent, so if a previous run failed partway through, just re-run
# this with the same LETSENCRYPT_EMAIL.
#
# Why this dance: the nginx config's https server blocks reference
# /etc/letsencrypt/live/<domain>/*.pem, so nginx refuses to even start until
# those files exist — but certbot can't issue real certs until nginx is up
# and serving the http-01 challenge. So: fake certs first (just to satisfy
# nginx's ssl_certificate directives), start nginx, then swap in real ones.
#
# Per-domain, not all-or-nothing: if real-cert issuance fails for one
# domain (bad DNS, a CDN/firewall blocking the http-01 challenge, etc.), a
# dummy cert is put back for it immediately so nginx keeps running on both
# domains instead of crash-looping the next time it restarts — only the
# failed domain stays on a self-signed (browser-untrusted) cert until you
# fix the underlying issue and re-run.
#
# After this runs successfully, renewals are just:
#   docker compose run --rm certbot renew --webroot -w /var/www/certbot
#   docker compose exec nginx nginx -s reload
# (wire that into a host cron job — see deploy/README.md).
#
# Requires: docker, docker compose (v2), openssl — all on the host running
# this script.

set -uo pipefail # deliberately not -e: a failure on one domain must not
                  # abort before the other domain (or nginx itself) is left
                  # in a working state — see create_dummy_cert/request_real_cert below.
cd "$(dirname "$0")/../.."

WALLET_DOMAIN="${WALLET_DOMAIN:-packeta.ir}"
PAY_DOMAIN="${PAY_DOMAIN:-pay.packeta.ir}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
STAGING="${STAGING:-0}" # set STAGING=1 first to test against LE's staging CA (no rate limits)

CERTBOT_CONF="./deploy/certbot/conf"
CERTBOT_WWW="./deploy/certbot/www"

if [ -z "$LETSENCRYPT_EMAIL" ]; then
  echo "Set LETSENCRYPT_EMAIL first, e.g.:" >&2
  echo "  LETSENCRYPT_EMAIL=you@example.com ./deploy/docker/init-letsencrypt.sh" >&2
  exit 1
fi

staging_arg=""
if [ "$STAGING" = "1" ]; then
  staging_arg="--staging"
fi

create_dummy_cert() {
  local domain="$1"
  mkdir -p "$CERTBOT_CONF/live/$domain"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "$CERTBOT_CONF/live/$domain/privkey.pem" \
    -out "$CERTBOT_CONF/live/$domain/fullchain.pem" \
    -subj "/CN=localhost" >/dev/null 2>&1
}

# Requests a real cert for $1, replacing whatever's currently at that path
# (dummy or an old real one). On failure, puts a dummy cert back so nginx
# has *something* to load next time it starts, and returns non-zero so the
# caller can track that this domain still needs a re-run.
request_real_cert() {
  local domain="$1"
  rm -rf "$CERTBOT_CONF/live/$domain" "$CERTBOT_CONF/archive/$domain" "$CERTBOT_CONF/renewal/$domain.conf"
  if docker compose run --rm certbot certonly \
    --webroot -w /var/www/certbot \
    $staging_arg \
    --email "$LETSENCRYPT_EMAIL" \
    -d "$domain" \
    --rsa-key-size 2048 \
    --agree-tos \
    --no-eff-email \
    --non-interactive \
    --force-renewal; then
    echo "### $domain: real cert issued."
    return 0
  else
    echo "### $domain: cert issuance FAILED (see certbot output above) — putting a dummy cert back so nginx stays up." >&2
    create_dummy_cert "$domain"
    return 1
  fi
}

mkdir -p "$CERTBOT_WWW"

for domain in "$WALLET_DOMAIN" "$PAY_DOMAIN"; do
  echo "### Ensuring a cert exists for $domain so nginx can (re)start ..."
  if [ ! -f "$CERTBOT_CONF/live/$domain/fullchain.pem" ]; then
    create_dummy_cert "$domain"
  fi
done

echo "### Starting nginx ..."
docker compose up -d nginx

failed=0
for domain in "$WALLET_DOMAIN" "$PAY_DOMAIN"; do
  # A renewal config only exists once certbot has actually issued a real
  # cert for this domain (our dummy certs are plain openssl output, not
  # certbot-managed) — skip domains that already have one so re-running
  # this script to fix one broken domain doesn't needlessly re-issue (and
  # burn rate limit on) the other, already-working one.
  if [ -f "$CERTBOT_CONF/renewal/$domain.conf" ] && [ "${FORCE_RENEW:-0}" != "1" ]; then
    echo "### $domain: already has a real cert, skipping (set FORCE_RENEW=1 to redo it anyway)."
    continue
  fi
  request_real_cert "$domain" || failed=1
done

echo "### Reloading nginx ..."
docker compose exec nginx nginx -s reload

if [ "$failed" -ne 0 ]; then
  echo
  echo "One or more domains are still on a self-signed cert — see the FAILED" >&2
  echo "line(s) above for which. nginx is up and serving on both domains" >&2
  echo "regardless (real cert where issuance succeeded, dummy where it" >&2
  echo "didn't), so the site isn't down. Fix the underlying issue (DNS," >&2
  echo "firewall/CDN in front of port 80, etc.) and re-run this script — it" >&2
  echo "only retries domains that don't already have a real cert." >&2
  exit 1
fi

echo "Done. $WALLET_DOMAIN and $PAY_DOMAIN should now serve over HTTPS."
