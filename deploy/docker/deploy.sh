#!/usr/bin/env bash
# Updates a running Docker Compose deployment (deploy/README.md, Option A)
# to the latest code on a branch, in one command. Run from anywhere on the
# server:
#
#   ./deploy/docker/deploy.sh                 # current branch
#   ./deploy/docker/deploy.sh some-branch     # switch to and deploy a branch
#
# Steps:
#   1. git pull (fast-forward only — never rewrites local history)
#   2. pg_dump the wallet database into ./backups/ before anything migrates
#   3. rebuild the four app images (Vite bakes the domain URLs in at build)
#   4. restart them — the backend container runs pending migrations on
#      start (see backend/Dockerfile's CMD), then the app
#   5. wait for the backend to come back, fail loudly if it didn't
#   6. (re)start nginx and reload its config
#
# First-time setup (DNS, TLS certs) is NOT done here — see
# init-letsencrypt.sh and deploy/README.md for that. Postgres/Mongo data
# volumes are never touched.
#
# Settings (env vars, all optional):
#   SKIP_BACKUP=1     skip step 2
#   SKIP_PULL=1       deploy whatever is checked out right now
#   BACKUP_KEEP=10    how many database dumps to keep in ./backups/

set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"
BRANCH="${1:-}"
BACKUP_KEEP="${BACKUP_KEEP:-10}"
COMPOSE=(docker compose)

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "docker is not installed"
"${COMPOSE[@]}" version >/dev/null 2>&1 || fail "docker compose v2 is not available"

# --- 1. code -----------------------------------------------------------------
if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    fail "There are uncommitted changes in $REPO_ROOT — commit or stash them first"
  fi
  if [[ -n "$BRANCH" ]]; then
    log "Switching to branch $BRANCH"
    git fetch origin "$BRANCH"
    git checkout "$BRANCH"
  fi
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  log "Pulling latest $BRANCH"
  git pull --ff-only origin "$BRANCH"
fi
log "Deploying $(git log -1 --format='%h %s')"

# --- 2. backup ---------------------------------------------------------------
if [[ "${SKIP_BACKUP:-0}" != "1" ]]; then
  if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx postgres; then
    mkdir -p backups
    BACKUP_FILE="backups/packeta-$(date +%Y%m%d-%H%M%S).sql.gz"
    log "Backing up the wallet database to $BACKUP_FILE"
    # Credentials come from the postgres container's own environment, so
    # this follows whatever docker-compose.yml / .env configure.
    "${COMPOSE[@]}" exec -T postgres sh -c \
      'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' \
      | gzip > "$BACKUP_FILE"
    [[ -s "$BACKUP_FILE" ]] || fail "Backup came out empty — aborting before migrating"
    ls -1t backups/packeta-*.sql.gz | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm --
  else
    log "Postgres isn't running yet (first deploy?) — skipping backup"
  fi
fi

# --- 3. build ----------------------------------------------------------------
APP_SERVICES=(backend ipg-backend frontend ipg-frontend)
log "Building ${APP_SERVICES[*]}"
"${COMPOSE[@]}" build "${APP_SERVICES[@]}"

# --- 4. restart (migrations run inside the backend container on start) ---
log "Starting databases and apps"
"${COMPOSE[@]}" up -d postgres ipg-postgres mongo mongo-express
"${COMPOSE[@]}" up -d "${APP_SERVICES[@]}"

# --- 5. health ---------------------------------------------------------------
log "Waiting for the backend (migrations + startup)"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T backend \
      node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
    BACKEND_UP=1
    break
  fi
  sleep 3
done
if [[ "${BACKEND_UP:-0}" != "1" ]]; then
  "${COMPOSE[@]}" logs --tail 80 backend
  fail "Backend did not come up — see the logs above. The pre-deploy dump is in ./backups/"
fi
"${COMPOSE[@]}" logs --tail 200 backend 2>/dev/null \
  | grep -E "Migration .* has been +executed successfully|No migrations are pending" || true

# --- 6. nginx ----------------------------------------------------------------
if [[ -d deploy/certbot/conf/live ]]; then
  log "Starting/reloading nginx"
  "${COMPOSE[@]}" up -d nginx
  "${COMPOSE[@]}" exec -T nginx nginx -s reload || true
else
  log "No TLS certs yet — run deploy/docker/init-letsencrypt.sh once, then nginx will serve the domains"
fi

"${COMPOSE[@]}" ps
log "Done"
