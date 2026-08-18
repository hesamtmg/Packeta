#!/usr/bin/env bash
# One-time bootstrap for TLS certs on a fresh server. Run this ONCE from the
# repo root, after DNS for both domains already points at this machine and
# ports 80/443 are reachable from the internet.
#
# Why this dance: the nginx config's https server blocks reference
# /etc/letsencrypt/live/<domain>/*.pem, so nginx refuses to even start until
# those files exist — but certbot can't issue real certs until nginx is up
# and serving the http-01 challenge. So: fake certs first (just to satisfy
# nginx's ssl_certificate directives), start nginx, then swap in real ones.
#
# After this runs once, renewals are just:
#   docker compose run --rm certbot renew --webroot -w /var/www/certbot
#   docker compose exec nginx nginx -s reload
# (wire that into a host cron job — see deploy/README.md).
#
# Requires: docker, docker compose (v2), openssl — all on the host running
# this script.

set -euo pipefail
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

mkdir -p "$CERTBOT_WWW"

for domain in "$WALLET_DOMAIN" "$PAY_DOMAIN"; do
  echo "### Creating a dummy cert for $domain so nginx can start ..."
  mkdir -p "$CERTBOT_CONF/live/$domain"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "$CERTBOT_CONF/live/$domain/privkey.pem" \
    -out "$CERTBOT_CONF/live/$domain/fullchain.pem" \
    -subj "/CN=localhost"
done

echo "### Starting nginx with the dummy certs ..."
docker compose up -d nginx

echo "### Deleting dummy certs ..."
for domain in "$WALLET_DOMAIN" "$PAY_DOMAIN"; do
  rm -rf "$CERTBOT_CONF/live/$domain" "$CERTBOT_CONF/archive/$domain" "$CERTBOT_CONF/renewal/$domain.conf"
done

staging_arg=""
if [ "$STAGING" = "1" ]; then
  staging_arg="--staging"
fi

echo "### Requesting a real cert for $WALLET_DOMAIN (+ www) ..."
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  $staging_arg \
  --email "$LETSENCRYPT_EMAIL" \
  -d "$WALLET_DOMAIN" -d "www.$WALLET_DOMAIN" \
  --rsa-key-size 2048 \
  --agree-tos \
  --no-eff-email \
  --non-interactive \
  --force-renewal

echo "### Requesting a real cert for $PAY_DOMAIN ..."
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  $staging_arg \
  --email "$LETSENCRYPT_EMAIL" \
  -d "$PAY_DOMAIN" \
  --rsa-key-size 2048 \
  --agree-tos \
  --no-eff-email \
  --non-interactive \
  --force-renewal

echo "### Reloading nginx with the real certs ..."
docker compose exec nginx nginx -s reload

echo "Done. $WALLET_DOMAIN and $PAY_DOMAIN should now serve over HTTPS."
