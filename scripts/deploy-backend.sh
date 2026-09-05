#!/bin/bash
# Deploy the Scout Quest custom API backend to the VM
# Usage: ./scripts/deploy-backend.sh [gcloud|<VM_IP>]
#
# Steps:
#   1. Build TypeScript locally
#   2. Create tarball of pre-built artifacts
#   3. Upload tarball to VM
#   4. Extract into /opt/scoutcoach/scout-quest/backend/
#   5. Rebuild Docker image + restart via docker compose

set -euo pipefail

MODE="${1:-gcloud}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="${PROJECT_ROOT}/backend"
PROJECT_ID="${PROJECT_ID:-scout-assistant-487523}"

# gcloud mode: identity, impersonation and IAP come from the shared lib (same
# as ssh-vm.sh / deploy-mcp-dist.sh / update-caddyfile.sh). The lib exports
# CLOUDSDK_CORE_ACCOUNT / CLOUDSDK_CORE_PROJECT / CLOUDSDK_AUTH_IMPERSONATE_
# SERVICE_ACCOUNT, so the gcloud calls below inherit the pinned identity.
# Bare gcloud could not reach the VM from the devbox. See docs/gcloud-admin-mode.md.
if [ "$MODE" = "gcloud" ]; then
  source "${SCRIPT_DIR}/lib/gcloud-identity.sh"
  gcloud_identity_preflight || exit 1
fi

# --- Build locally ---
echo "=== Building Scout Quest backend ==="
cd "$BACKEND_DIR"

# Use nvm node 24 if available, else system node
if command -v nvm &>/dev/null 2>&1; then
  source ~/.nvm/nvm.sh
  nvm use 24 2>/dev/null || true
fi

npm install
npx tsc

echo "Build complete"

# --- Inject build stamp into voice.html ---
ADJECTIVES=(chunky sneaky cosmic turbo blazing fuzzy mighty nano hyper silent noble rusty swift golden spicy)
NOUNS=(dino falcon eagle otter phoenix badger panda raven scout turtle hawk cobra moose bison crane)
ADJ=${ADJECTIVES[$((RANDOM % ${#ADJECTIVES[@]}))]}
NOUN=${NOUNS[$((RANDOM % ${#NOUNS[@]}))]}
BUILD_NAME="${ADJ}-${NOUN}"
BUILD_TIME=$(date -u +"%Y-%m-%d %H:%M UTC")
BUILD_STAMP="${BUILD_NAME} | ${BUILD_TIME}"
echo "  Build: ${BUILD_STAMP}"

# Build stamp is injected into a temp copy (source stays untouched)
BUILD_EPOCH=$(date +%s)

# --- Create tarball (dist + node_modules + Dockerfile + knowledge) ---
echo ""
echo "=== Creating deploy tarball ==="
TEMP_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_DIR'" EXIT

# Stage all deploy files in a temp dir so we can stamp without modifying source
STAGE_DIR="$TEMP_DIR/stage"
mkdir -p "$STAGE_DIR"
cp -r "$BACKEND_DIR/dist" "$BACKEND_DIR/node_modules" "$BACKEND_DIR/knowledge" "$BACKEND_DIR/public" "$STAGE_DIR/"
cp "$BACKEND_DIR/package.json" "$BACKEND_DIR/package-lock.json" "$BACKEND_DIR/Dockerfile" "$STAGE_DIR/"

# Stage the cost rate card so the container can resolve config/pricing.yaml
# (the Dockerfile COPYs config/). Without this the backend logs ENOENT at
# startup and every costUsd falls back to 0.
mkdir -p "$STAGE_DIR/config"
cp "$PROJECT_ROOT/config/pricing.yaml" "$STAGE_DIR/config/"

# Stamp the staged copy
for f in "$STAGE_DIR/public/voice.html" "$STAGE_DIR/public/app.html"; do
  if [ -f "$f" ]; then
    sed -i "s#<!-- __BUILD_STAMP__ -->#${BUILD_STAMP}#g" "$f"
    sed -i "s#__BUILD_EPOCH__#${BUILD_EPOCH}#g" "$f"
    echo "  Stamped $(basename $f)"
  fi
done

TARBALL="$TEMP_DIR/backend-deploy.tar.gz"
cd "$STAGE_DIR"
tar czf "$TARBALL" dist/ node_modules/ knowledge/ public/ config/ package.json package-lock.json Dockerfile
echo "  Tarball: $(du -h "$TARBALL" | cut -f1)"

# --- Upload to VM ---
echo ""
echo "=== Uploading to VM ==="
if [ "$MODE" = "gcloud" ]; then
  # Use sudo so cleanup works when the staging dir is owned by a different
  # OS-Login user from a previous deploy (e.g. different SA impersonation).
  gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" --tunnel-through-iap \
    --command="sudo rm -rf /tmp/scout-backend-deploy && sudo mkdir -p /tmp/scout-backend-deploy && sudo chown \$(whoami) /tmp/scout-backend-deploy" 2>/dev/null || true

  gcloud compute scp "$TARBALL" \
    "scout-coach-vm:/tmp/scout-backend-deploy/backend-deploy.tar.gz" \
    --zone=us-east4-b --project="$PROJECT_ID" --tunnel-through-iap
else
  ssh -o StrictHostKeyChecking=no "ubuntu@$MODE" \
    "rm -rf /tmp/scout-backend-deploy && mkdir -p /tmp/scout-backend-deploy" 2>/dev/null || true

  scp -o StrictHostKeyChecking=no "$TARBALL" \
    "ubuntu@$MODE:/tmp/scout-backend-deploy/backend-deploy.tar.gz"
fi

echo "  Upload complete"

# --- Set up on VM ---
echo ""
echo "=== Deploying on VM ==="

REMOTE_SCRIPT='
set -e

SQUAD_DIR="/opt/scoutcoach/scout-quest"
BACKEND_DIR="${SQUAD_DIR}/backend"
SRC_DIR="/tmp/scout-backend-deploy"

echo "  Creating backend directory..."
sudo mkdir -p "$BACKEND_DIR"
sudo chown scoutcoach:scoutcoach "$BACKEND_DIR"

echo "  Extracting tarball..."
sudo -u scoutcoach tar xzf "$SRC_DIR/backend-deploy.tar.gz" -C "$BACKEND_DIR"

# Snapshot the current backend logs before the container is recreated.
# Rationale: `docker compose build backend` + `up -d` removes the prior
# container and wipes /var/lib/docker/containers/<id>/<id>-json.log. We
# lost Jeremy'\''s voice chat with Ben (2026-04-18) when a deploy overwrote
# logs needed to investigate a mid-session backend error. One rotating
# archive per deploy is enough to make that case survivable.
echo "  Snapshotting pre-deploy backend logs..."
ARCHIVE_DIR="/var/log/scoutcoach/backend"
sudo mkdir -p "$ARCHIVE_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
sudo -u scoutcoach docker compose -f "$SQUAD_DIR/docker-compose.yml" logs --timestamps backend \
  | sudo tee "$ARCHIVE_DIR/backend.predeploy.${STAMP}.log" >/dev/null 2>&1 || true
# Keep the most recent 10 archives (rotate by mtime).
sudo bash -c "ls -1t $ARCHIVE_DIR/backend.predeploy.*.log 2>/dev/null | tail -n +11 | xargs -r rm -f"

echo "  Building Docker image..."
cd "$SQUAD_DIR"
sudo -u scoutcoach docker compose build backend

echo "  Restarting backend container..."
sudo -u scoutcoach docker compose up -d backend

echo "  Checking health..."
sleep 5
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3090/health 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  echo "  Backend is healthy (HTTP 200)"
else
  echo "  WARNING: Backend returned HTTP $HTTP_CODE"
  sudo -u scoutcoach docker compose logs --tail=20 backend
fi

rm -rf /tmp/scout-backend-deploy
echo ""
echo "  Backend deployed!"
'

if [ "$MODE" = "gcloud" ]; then
  gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" --tunnel-through-iap --command="$REMOTE_SCRIPT"
else
  ssh -o StrictHostKeyChecking=no "ubuntu@$MODE" "$REMOTE_SCRIPT"
fi

echo ""
echo "============================================"
echo "Backend deployed!"
echo "  Health: http://scout-quest-backend:3090/health (inside Docker network)"
echo "============================================"
