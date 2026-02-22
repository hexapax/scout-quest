#!/bin/bash
# Deploy the admin app to the VM
# Usage: ./scripts/deploy-admin.sh [gcloud|<VM_IP>]
#
# Steps:
#   1. Build admin app locally (TypeScript)
#   2. Create tarball of pre-built artifacts
#   3. SCP tarball to VM (fast — single file vs thousands)
#   4. Build Docker image on VM (no npm install needed)
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

# --- Create tarball ---
echo ""
echo "=== Creating deploy tarball ==="
TEMP_DIR=$(mktemp -d)
trap "rm -rf '$TEMP_DIR'" EXIT

TARBALL="$TEMP_DIR/admin-deploy.tar.gz"

# Tar pre-built artifacts (dist + node_modules + Dockerfile + package.json)
cd "$ADMIN_DIR"
tar czf "$TARBALL" dist/ node_modules/ package.json Dockerfile
echo "  Tarball created: $(du -h "$TARBALL" | cut -f1)"

# Pull .env from GCS
echo ""
echo "=== Pulling admin .env from GCS ==="
GCS_PATH="gs://scout-assistant-487523-tfstate/config/admin/.env"
if gsutil cp "$GCS_PATH" "$TEMP_DIR/admin.env" 2>/dev/null; then
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
  gcloud compute ssh scout-coach-vm --zone=us-east4-b \
    --command="rm -rf /tmp/scout-admin-deploy && mkdir -p /tmp/scout-admin-deploy" 2>/dev/null || true

  gcloud compute scp "$TARBALL" \
    "scout-coach-vm:/tmp/scout-admin-deploy/admin-deploy.tar.gz" --zone=us-east4-b
  gcloud compute scp "$TEMP_DIR/admin.env" \
    "scout-coach-vm:/tmp/scout-admin-deploy/admin.env" --zone=us-east4-b
  gcloud compute scp "$CONFIG_DIR/docker-compose.yml" \
    "scout-coach-vm:/tmp/scout-admin-deploy/docker-compose.yml" --zone=us-east4-b
  if [ -f "$CONFIG_DIR/docker-compose.override.yml" ]; then
    gcloud compute scp "$CONFIG_DIR/docker-compose.override.yml" \
      "scout-coach-vm:/tmp/scout-admin-deploy/docker-compose.override.yml" --zone=us-east4-b
  fi
else
  ssh -o StrictHostKeyChecking=no "ubuntu@$MODE" \
    "rm -rf /tmp/scout-admin-deploy && mkdir -p /tmp/scout-admin-deploy" 2>/dev/null || true
  scp -o StrictHostKeyChecking=no "$TARBALL" \
    "ubuntu@$MODE:/tmp/scout-admin-deploy/admin-deploy.tar.gz"
  scp -o StrictHostKeyChecking=no "$TEMP_DIR/admin.env" \
    "ubuntu@$MODE:/tmp/scout-admin-deploy/admin.env"
  scp -o StrictHostKeyChecking=no "$CONFIG_DIR/docker-compose.yml" \
    "ubuntu@$MODE:/tmp/scout-admin-deploy/docker-compose.yml"
  if [ -f "$CONFIG_DIR/docker-compose.override.yml" ]; then
    scp -o StrictHostKeyChecking=no "$CONFIG_DIR/docker-compose.override.yml" \
      "ubuntu@$MODE:/tmp/scout-admin-deploy/docker-compose.override.yml"
  fi
fi

echo "  Upload complete"

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

echo "  Extracting tarball..."
cd "$APP_DIR"
sudo tar xzf "$SRC_DIR/admin-deploy.tar.gz"

echo "  Copying config..."
sudo cp "$SRC_DIR/admin.env" "$APP_DIR/.env"
sudo cp "$SRC_DIR/docker-compose.yml" "$APP_DIR/docker-compose.yml"
if [ -f "$SRC_DIR/docker-compose.override.yml" ]; then
  sudo cp "$SRC_DIR/docker-compose.override.yml" "$APP_DIR/docker-compose.override.yml"
fi
sudo chown -R scoutcoach:scoutcoach "$APP_DIR"

# Create shared Docker network if needed
if ! sudo docker network inspect scout-shared >/dev/null 2>&1; then
  echo "  Creating scout-shared Docker network..."
  sudo docker network create scout-shared
fi

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
