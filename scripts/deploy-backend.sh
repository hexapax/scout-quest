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

# --- Create tarball (dist + node_modules + Dockerfile + knowledge) ---
echo ""
echo "=== Creating deploy tarball ==="
TEMP_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_DIR'" EXIT

TARBALL="$TEMP_DIR/backend-deploy.tar.gz"

cd "$BACKEND_DIR"
tar czf "$TARBALL" dist/ node_modules/ knowledge/ package.json Dockerfile
echo "  Tarball: $(du -h "$TARBALL" | cut -f1)"

# --- Upload to VM ---
echo ""
echo "=== Uploading to VM ==="
if [ "$MODE" = "gcloud" ]; then
  gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" \
    --command="rm -rf /tmp/scout-backend-deploy && mkdir -p /tmp/scout-backend-deploy" 2>/dev/null || true

  gcloud compute scp "$TARBALL" \
    "scout-coach-vm:/tmp/scout-backend-deploy/backend-deploy.tar.gz" \
    --zone=us-east4-b --project="$PROJECT_ID"
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
  gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" --command="$REMOTE_SCRIPT"
else
  ssh -o StrictHostKeyChecking=no "ubuntu@$MODE" "$REMOTE_SCRIPT"
fi

echo ""
echo "============================================"
echo "Backend deployed!"
echo "  Health: http://scout-quest-backend:3090/health (inside Docker network)"
echo "============================================"
