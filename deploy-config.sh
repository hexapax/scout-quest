#!/bin/bash
# ============================================
# deploy-config.sh — Push config to VM and start both LibreChat instances
# ============================================
# Run AFTER terraform apply creates the VM and you've:
#   1. Updated DNS (ai-chat.hexapax.com + scout-quest.hexapax.com → IP)
#   2. Filled in config/ai-chat/.env and config/scout-quest/.env with API keys
#   3. Filled in both .env files with Google OAuth credentials
#
# Usage: ./deploy-config.sh <VM_IP>
# Example: ./deploy-config.sh 34.85.123.45
#
# Alternative: use gcloud SSH (no key management)
#   ./deploy-config.sh gcloud

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTANCES=("ai-chat" "scout-quest")

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
echo "Scout Quest — Deploy Configuration"
echo "============================================"
echo ""

# --- Validate config files exist for both instances ---
for INSTANCE in "${INSTANCES[@]}"; do
  CONFIG_DIR="${SCRIPT_DIR}/config/${INSTANCE}"
  echo "→ Checking ${INSTANCE} config files..."
  for f in .env librechat.yaml docker-compose.override.yml; do
    if [ ! -f "${CONFIG_DIR}/${f}" ]; then
      echo "  ERROR: Missing ${CONFIG_DIR}/${f}"
      exit 1
    fi
    echo "  ${f} ✓"
  done
  echo ""
done

# --- Check for unfilled placeholders in both instances ---
for INSTANCE in "${INSTANCES[@]}"; do
  CONFIG_DIR="${SCRIPT_DIR}/config/${INSTANCE}"
  echo "→ Checking ${INSTANCE} for unfilled placeholders..."
  REQUIRED_UNFILLED=$(grep '<FILL_IN>' "${CONFIG_DIR}/.env" | grep -vc 'FILL_IN_OR_LEAVE' || true)
  OPTIONAL_UNFILLED=$(grep -c 'FILL_IN_OR_LEAVE' "${CONFIG_DIR}/.env" || true)

  if [ "${OPTIONAL_UNFILLED}" -gt 0 ]; then
    echo "  ${OPTIONAL_UNFILLED} optional provider(s) not configured (OK to skip)"
  fi

  if [ "${REQUIRED_UNFILLED}" -gt 0 ]; then
    echo ""
    echo "  WARNING: ${REQUIRED_UNFILLED} REQUIRED value(s) still set to <FILL_IN> in ${INSTANCE}:"
    grep -n '<FILL_IN>' "${CONFIG_DIR}/.env" | grep -v 'FILL_IN_OR_LEAVE' | sed 's/^/    /'
    echo ""
    read -p "  Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      echo "  Aborted. Fill in your .env values first."
      exit 1
    fi
  fi
  echo ""
done

# --- Wait for cloud-init ---
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

# --- Upload config files for both instances ---
echo ""
echo "→ Uploading config files..."
if [ "${1:-}" = "gcloud" ]; then
  for INSTANCE in "${INSTANCES[@]}"; do
    gcloud compute scp --recurse "${SCRIPT_DIR}/config/${INSTANCE}" \
      "scout-coach-vm:/tmp/scout-config-${INSTANCE}" --zone=us-east4-b
    echo "  ${INSTANCE} uploaded ✓"
  done
else
  for INSTANCE in "${INSTANCES[@]}"; do
    ssh -o StrictHostKeyChecking=no "ubuntu@${VM_IP}" "mkdir -p /tmp/scout-config-${INSTANCE}"
    scp -o StrictHostKeyChecking=no -r "${SCRIPT_DIR}/config/${INSTANCE}/." \
      "ubuntu@${VM_IP}:/tmp/scout-config-${INSTANCE}/"
    echo "  ${INSTANCE} uploaded ✓"
  done
fi

# --- Run remote setup ---
echo ""
echo "→ Configuring both LibreChat instances on VM..."

REMOTE_SCRIPT='
set -e

setup_instance() {
  local INSTANCE="$1"
  local APP_DIR="/opt/scoutcoach/${INSTANCE}"
  local SRC_DIR="/tmp/scout-config-${INSTANCE}"

  echo ""
  echo "  === Setting up ${INSTANCE} ==="

  echo "  Copying config files..."
  sudo cp "${SRC_DIR}/.env" "${APP_DIR}/.env"
  sudo cp "${SRC_DIR}/librechat.yaml" "${APP_DIR}/librechat.yaml"
  sudo cp "${SRC_DIR}/docker-compose.override.yml" "${APP_DIR}/docker-compose.override.yml"
  sudo chown -R scoutcoach:scoutcoach "${APP_DIR}/.env" "${APP_DIR}/librechat.yaml" "${APP_DIR}/docker-compose.override.yml"

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

  # --- Start the instance ---
  echo "  Pulling Docker images (this takes a few minutes first time)..."
  cd "${APP_DIR}"
  sudo -u scoutcoach docker compose pull
  sudo -u scoutcoach docker compose up -d

  echo "  Waiting for containers to be healthy..."
  sleep 10

  echo "  Container status:"
  sudo -u scoutcoach docker compose ps
}

# Set up MCP directory for scout-quest
echo "  Setting up MCP server directory..."
sudo -u scoutcoach mkdir -p /opt/scoutcoach/scout-quest/mcp-servers/scout-quest

# Deploy both instances
setup_instance "ai-chat"
setup_instance "scout-quest"

# --- Clean up ---
rm -rf /tmp/scout-config-ai-chat /tmp/scout-config-scout-quest

echo ""
echo "  Both LibreChat instances are starting up! ✓"
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

DOMAIN_AICHAT=$(grep "^DOMAIN_CLIENT=" "${SCRIPT_DIR}/config/ai-chat/.env" | cut -d= -f2)
DOMAIN_SCOUT=$(grep "^DOMAIN_CLIENT=" "${SCRIPT_DIR}/config/scout-quest/.env" | cut -d= -f2)

echo "Your instances are starting at:"
echo "  AI Chat (full access):    ${DOMAIN_AICHAT}"
echo "  Scout Quest (locked down): ${DOMAIN_SCOUT}"
echo ""
echo "NOTE: First HTTPS request may take ~30 seconds while"
echo "Caddy obtains the Let's Encrypt certificates."
echo ""
echo "NEXT STEPS:"
echo "  1. Visit each URL above"
echo "  2. Register YOUR account on both instances first (becomes admin)"
echo "  3. Add scout emails as test users in GCP OAuth consent screen"
echo "  4. Have scouts sign in on the Scout Quest instance"
echo "  5. Set ALLOW_REGISTRATION=false in both .env files"
echo "  6. Re-run this script to apply the change"
echo ""
echo "USEFUL COMMANDS (SSH in first: gcloud compute ssh scout-coach-vm --zone=us-east4-b):"
echo "  AI Chat logs:      cd /opt/scoutcoach/ai-chat && docker compose logs -f api"
echo "  Scout Quest logs:  cd /opt/scoutcoach/scout-quest && docker compose logs -f api"
echo "  Restart ai-chat:   cd /opt/scoutcoach/ai-chat && docker compose restart"
echo "  Restart scout:     cd /opt/scoutcoach/scout-quest && docker compose restart"
echo "  Caddy logs:        sudo journalctl -u caddy -f"
echo ""
