#!/bin/bash
# ============================================
# deploy-config.sh — Push config to VM and start LibreChat
# ============================================
# Run AFTER terraform apply creates the VM and you've:
#   1. Updated DNS (scout.hexapax.com → IP)
#   2. Filled in config/.env with API keys
#   3. Filled in config/.env with Google OAuth credentials
#
# Usage: ./deploy-config.sh <VM_IP>
# Example: ./deploy-config.sh 34.85.123.45
#
# Alternative: use gcloud SSH (no key management)
#   ./deploy-config.sh gcloud

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${SCRIPT_DIR}/config"

if [ "${1:-}" = "gcloud" ]; then
  SSH_CMD="gcloud compute ssh scout-coach-vm --zone=us-east4-b --command"
  SCP_CMD="gcloud compute scp"
  VM_TARGET="scout-coach-vm"
  echo "Using gcloud SSH..."
else
  VM_IP="${1:?Usage: ./deploy-config.sh <VM_IP> or ./deploy-config.sh gcloud}"
  SSH_CMD="ssh -o StrictHostKeyChecking=no ubuntu@${VM_IP}"
  SCP_CMD="scp -o StrictHostKeyChecking=no"
  VM_TARGET="ubuntu@${VM_IP}"
  echo "Using direct SSH to ${VM_IP}..."
fi

echo ""
echo "============================================"
echo "Scout Coach — Deploy Configuration"
echo "============================================"
echo ""

# --- Validate config files exist ---
echo "→ Checking config files..."
for f in .env librechat.yaml docker-compose.override.yml; do
  if [ ! -f "${CONFIG_DIR}/${f}" ]; then
    echo "  ERROR: Missing ${CONFIG_DIR}/${f}"
    exit 1
  fi
  echo "  ${f} ✓"
done

# --- Check for unfilled placeholders ---
echo ""
echo "→ Checking for unfilled placeholders..."
REQUIRED_UNFILLED=$(grep '<FILL_IN>' "${CONFIG_DIR}/.env" | grep -vc 'FILL_IN_OR_LEAVE' || true)
OPTIONAL_UNFILLED=$(grep -c 'FILL_IN_OR_LEAVE' "${CONFIG_DIR}/.env" || true)

if [ "${OPTIONAL_UNFILLED}" -gt 0 ]; then
  echo "  ${OPTIONAL_UNFILLED} optional provider(s) not configured (OK to skip)"
fi

if [ "${REQUIRED_UNFILLED}" -gt 0 ]; then
  echo ""
  echo "  WARNING: ${REQUIRED_UNFILLED} REQUIRED value(s) still set to <FILL_IN>:"
  grep -n '<FILL_IN>' "${CONFIG_DIR}/.env" | grep -v 'FILL_IN_OR_LEAVE' | sed 's/^/    /'
  echo ""
  read -p "  Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "  Aborted. Fill in your .env values first."
    exit 1
  fi
fi

# --- Wait for cloud-init ---
echo ""
echo "→ Waiting for VM cloud-init to complete..."
ATTEMPTS=0
MAX_ATTEMPTS=30
while true; do
  if [ "${1:-}" = "gcloud" ]; then
    READY=$(gcloud compute ssh scout-coach-vm --zone=us-east4-b \
      --command="test -f /opt/scoutcoach/.cloud-init-complete && echo yes || echo no" 2>/dev/null || echo "no")
  else
    READY=$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "ubuntu@${VM_IP}" \
      "test -f /opt/scoutcoach/.cloud-init-complete && echo yes || echo no" 2>/dev/null || echo "no")
  fi

  if [ "${READY}" = "yes" ]; then
    echo "  Cloud-init complete ✓"
    break
  fi

  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "${ATTEMPTS}" -ge "${MAX_ATTEMPTS}" ]; then
    echo "  ERROR: Timed out waiting for cloud-init (${MAX_ATTEMPTS} attempts)"
    echo "  SSH in manually to check: /var/log/cloud-init-output.log"
    exit 1
  fi

  echo "  Attempt ${ATTEMPTS}/${MAX_ATTEMPTS} — still initializing..."
  sleep 15
done

# --- Upload config files ---
echo ""
echo "→ Uploading config files..."
if [ "${1:-}" = "gcloud" ]; then
  gcloud compute scp --recurse "${CONFIG_DIR}" "scout-coach-vm:/tmp/scout-config" --zone=us-east4-b
else
  ssh -o StrictHostKeyChecking=no "ubuntu@${VM_IP}" "mkdir -p /tmp/scout-config"
  scp -o StrictHostKeyChecking=no -r "${CONFIG_DIR}/." "ubuntu@${VM_IP}:/tmp/scout-config/"
fi
echo "  Files uploaded ✓"

# --- Run remote setup ---
echo ""
echo "→ Configuring LibreChat on VM..."

REMOTE_SCRIPT='
set -e
APP_DIR=/opt/scoutcoach/librechat

echo "  Copying config files..."
sudo cp /tmp/scout-config/.env "${APP_DIR}/.env"
sudo cp /tmp/scout-config/librechat.yaml "${APP_DIR}/librechat.yaml"
sudo cp /tmp/scout-config/docker-compose.override.yml "${APP_DIR}/docker-compose.override.yml"
sudo chown -R scoutcoach:scoutcoach "${APP_DIR}/.env" "${APP_DIR}/librechat.yaml" "${APP_DIR}/docker-compose.override.yml"

echo "  Setting up MCP server directory..."
sudo -u scoutcoach mkdir -p "${APP_DIR}/mcp-servers/scout-quest"

# --- Generate security keys if needed ---
if grep -q "<GENERATE>" "${APP_DIR}/.env"; then
  echo "  Generating security keys..."
  CREDS_IV=$(openssl rand -hex 16)
  CREDS_KEY=$(openssl rand -hex 32)
  JWT_SECRET=$(openssl rand -hex 32)
  JWT_REFRESH=$(openssl rand -hex 32)
  sudo sed -i "s|CREDS_IV=<GENERATE>|CREDS_IV=${CREDS_IV}|" "${APP_DIR}/.env"
  sudo sed -i "s|CREDS_KEY=<GENERATE>|CREDS_KEY=${CREDS_KEY}|" "${APP_DIR}/.env"
  sudo sed -i "s|JWT_SECRET=<GENERATE>|JWT_SECRET=${JWT_SECRET}|" "${APP_DIR}/.env"
  sudo sed -i "s|JWT_REFRESH_SECRET=<GENERATE>|JWT_REFRESH_SECRET=${JWT_REFRESH}|" "${APP_DIR}/.env"
  echo "  Security keys generated ✓"
fi

# --- Start LibreChat ---
echo "  Pulling Docker images (this takes a few minutes first time)..."
cd "${APP_DIR}"
sudo -u scoutcoach docker compose pull
sudo -u scoutcoach docker compose up -d

echo "  Waiting for containers to be healthy..."
sleep 10

echo "  Container status:"
sudo -u scoutcoach docker compose ps

# --- Clean up ---
rm -rf /tmp/scout-config

echo ""
echo "  LibreChat is starting up! ✓"
'

if [ "${1:-}" = "gcloud" ]; then
  gcloud compute ssh scout-coach-vm --zone=us-east4-b --command="${REMOTE_SCRIPT}"
else
  ssh -o StrictHostKeyChecking=no "ubuntu@${VM_IP}" "${REMOTE_SCRIPT}"
fi

echo ""
echo "============================================"
echo "Deployment complete!"
echo "============================================"
echo ""
echo "Your Scout Coach is starting at:"
if [ "${1:-}" = "gcloud" ]; then
  DOMAIN=$(grep "^DOMAIN_CLIENT=" "${CONFIG_DIR}/.env" | cut -d= -f2)
  echo "  ${DOMAIN}"
else
  echo "  https://scout.hexapax.com"
fi
echo ""
echo "NOTE: First HTTPS request may take ~30 seconds while"
echo "Caddy obtains the Let's Encrypt certificate."
echo ""
echo "NEXT STEPS:"
echo "  1. Visit the URL above"
echo "  2. Register YOUR account first (becomes admin)"
echo "  3. Register Will's account"
echo "  4. Set ALLOW_REGISTRATION=false in .env"
echo "  5. Re-run this script to apply the change"
echo ""
echo "USEFUL COMMANDS:"
echo "  SSH:     gcloud compute ssh scout-coach-vm --zone=us-east4-b"
echo "  Logs:    docker compose logs -f api"
echo "  Restart: docker compose restart"
echo "  Update:  docker compose pull && docker compose up -d"
echo ""
