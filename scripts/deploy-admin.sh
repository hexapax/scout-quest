#!/bin/bash
# Deploy the admin app to the VM
# Usage: ./scripts/deploy-admin.sh [gcloud|<VM_IP>]
#
# Steps:
#   1. Build admin app locally (TypeScript)
#   2. Create tarball of admin source + built files
#   3. SCP to VM
#   4. Build Docker image on VM
#   5. Start container

set -euo pipefail

MODE="${1:-gcloud}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ADMIN_DIR="${PROJECT_ROOT}/admin"
CONFIG_DIR="${PROJECT_ROOT}/config/admin"

# --- Build locally first ---
echo "=== Building admin app ==="
cd "$ADMIN_DIR"
source ~/.nvm/nvm.sh
nvm use 24 2>/dev/null
npm install
npx tsc
echo "Build complete"

# --- Create temp upload dir ---
TEMP_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_DIR'" EXIT

# Copy admin source for Docker build on VM
mkdir -p "$TEMP_DIR/admin"
cp -r "$ADMIN_DIR/src" "$TEMP_DIR/admin/src"
cp "$ADMIN_DIR/package.json" "$TEMP_DIR/admin/"
cp "$ADMIN_DIR/package-lock.json" "$TEMP_DIR/admin/" 2>/dev/null || true
cp "$ADMIN_DIR/tsconfig.json" "$TEMP_DIR/admin/"
cp "$ADMIN_DIR/Dockerfile" "$TEMP_DIR/admin/"

# Copy config
mkdir -p "$TEMP_DIR/config"
cp "$CONFIG_DIR/docker-compose.yml" "$TEMP_DIR/config/"
cp "$CONFIG_DIR/docker-compose.override.yml" "$TEMP_DIR/config/" 2>/dev/null || true

# Copy .env from GCS
echo ""
echo "=== Pulling admin .env from GCS ==="
GCS_PATH="gs://scout-assistant-487523-tfstate/config/admin/.env"
if gsutil cp "$GCS_PATH" "$TEMP_DIR/config/.env" 2>/dev/null; then
  echo "  admin/.env pulled from GCS"
else
  echo "  WARNING: No admin .env in GCS yet. Copy config/admin/.env.example to config/admin/.env, fill it in, then run:"
  echo "    gsutil cp config/admin/.env gs://scout-assistant-487523-tfstate/config/admin/.env"
  exit 1
fi

# --- Upload to VM ---
echo ""
echo "=== Uploading to VM ==="
if [ "$MODE" = "gcloud" ]; then
  # Clean stale temp dirs
  gcloud compute ssh scout-coach-vm --zone=us-east4-b \
    --command="rm -rf /tmp/scout-admin-deploy" 2>/dev/null || true

  gcloud compute scp --recurse "$TEMP_DIR" \
    "scout-coach-vm:/tmp/scout-admin-deploy" --zone=us-east4-b
else
  ssh -o StrictHostKeyChecking=no "ubuntu@$MODE" \
    "rm -rf /tmp/scout-admin-deploy" 2>/dev/null || true
  scp -o StrictHostKeyChecking=no -r "$TEMP_DIR" \
    "ubuntu@$MODE:/tmp/scout-admin-deploy"
fi

# --- Set up on VM ---
echo ""
echo "=== Setting up on VM ==="

REMOTE_SCRIPT='
set -e

APP_DIR="/opt/scoutcoach/admin"
SRC_DIR="/tmp/scout-admin-deploy"

echo "  Creating admin directory..."
sudo mkdir -p "$APP_DIR"
sudo chown scoutcoach:scoutcoach "$APP_DIR"

echo "  Copying admin source..."
sudo cp -r "$SRC_DIR/admin/"* "$APP_DIR/"

echo "  Copying config..."
sudo cp "$SRC_DIR/config/.env" "$APP_DIR/.env"
sudo cp "$SRC_DIR/config/docker-compose.yml" "$APP_DIR/docker-compose.yml"
if [ -f "$SRC_DIR/config/docker-compose.override.yml" ]; then
  sudo cp "$SRC_DIR/config/docker-compose.override.yml" "$APP_DIR/docker-compose.override.yml"
fi
sudo chown -R scoutcoach:scoutcoach "$APP_DIR"

echo "  Building Docker image..."
cd "$APP_DIR"
sudo -u scoutcoach docker compose build

echo "  Starting admin container..."
sudo -u scoutcoach docker compose up -d

echo "  Checking health..."
sleep 5
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3082 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
  echo "  Admin panel is healthy (HTTP $HTTP_CODE)"
else
  echo "  WARNING: Admin panel returned HTTP $HTTP_CODE"
  sudo -u scoutcoach docker compose logs --tail=20
fi

rm -rf /tmp/scout-admin-deploy
echo ""
echo "  Admin app deployed!"
'

if [ "$MODE" = "gcloud" ]; then
  gcloud compute ssh scout-coach-vm --zone=us-east4-b --command="$REMOTE_SCRIPT"
else
  ssh -o StrictHostKeyChecking=no "ubuntu@$MODE" "$REMOTE_SCRIPT"
fi

echo ""
echo "============================================"
echo "Admin app deployed!"
echo "Visit: https://admin.hexapax.com"
echo "============================================"
