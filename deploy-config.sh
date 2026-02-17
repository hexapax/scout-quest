#!/bin/bash
# ============================================
# deploy-config.sh — Manage secrets in GCS and deploy to VM
# ============================================
#
# Usage:
#   ./deploy-config.sh push              Upload local .env files to GCS
#   ./deploy-config.sh pull              Download .env files from GCS to local
#   ./deploy-config.sh <VM_IP>           Deploy to VM via direct SSH
#   ./deploy-config.sh gcloud            Deploy to VM via gcloud SSH
#
# Deploy flow: pulls .env from GCS (secrets), combines with git-tracked
# librechat.yaml + docker-compose.override.yml, uploads everything to VM.
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - .env files pushed to GCS (run 'push' first)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTANCES=("ai-chat" "scout-quest")
PROJECT_ID="${PROJECT_ID:-scout-coach}"
GCS_BUCKET="gs://${PROJECT_ID}-tfstate"
GCS_CONFIG_PREFIX="config"

# --- GCS Push: upload local .env files to GCS ---
gcs_push() {
  echo ""
  echo "============================================"
  echo "Pushing .env files to GCS"
  echo "============================================"
  echo ""

  for INSTANCE in "${INSTANCES[@]}"; do
    local ENV_FILE="${SCRIPT_DIR}/config/${INSTANCE}/.env"
    local GCS_PATH="${GCS_BUCKET}/${GCS_CONFIG_PREFIX}/${INSTANCE}/.env"

    if [ ! -f "${ENV_FILE}" ]; then
      echo "  SKIP: ${ENV_FILE} does not exist"
      continue
    fi

    echo "  Uploading ${INSTANCE}/.env → ${GCS_PATH}"
    gsutil cp "${ENV_FILE}" "${GCS_PATH}"
    echo "  ${INSTANCE} ✓"
  done

  echo ""
  echo "Done. Secrets are stored in ${GCS_BUCKET}/${GCS_CONFIG_PREFIX}/"
}

# --- GCS Pull: download .env files from GCS to local ---
gcs_pull() {
  echo ""
  echo "============================================"
  echo "Pulling .env files from GCS"
  echo "============================================"
  echo ""

  for INSTANCE in "${INSTANCES[@]}"; do
    local ENV_FILE="${SCRIPT_DIR}/config/${INSTANCE}/.env"
    local GCS_PATH="${GCS_BUCKET}/${GCS_CONFIG_PREFIX}/${INSTANCE}/.env"

    echo "  Downloading ${GCS_PATH} → ${INSTANCE}/.env"
    if gsutil cp "${GCS_PATH}" "${ENV_FILE}" 2>/dev/null; then
      echo "  ${INSTANCE} ✓"
    else
      echo "  WARNING: ${GCS_PATH} not found in GCS — skipping"
    fi
  done

  echo ""
  echo "Done. Check config/*/.env files."
}

# --- Deploy to VM ---
deploy() {
  local MODE="$1"

  if [ "${MODE}" = "gcloud" ]; then
    SSH_CMD="gcloud compute ssh scout-coach-vm --zone=us-east4-b --command"
    SCP_CMD="gcloud compute scp"
    VM_TARGET="scout-coach-vm"
    echo "Using gcloud SSH..."
  else
    local VM_IP="${MODE}"
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

  # --- Pull .env files from GCS into a temp dir ---
  TEMP_DIR=$(mktemp -d)
  trap "rm -rf '${TEMP_DIR}'" EXIT

  echo "→ Pulling .env files from GCS..."
  for INSTANCE in "${INSTANCES[@]}"; do
    mkdir -p "${TEMP_DIR}/${INSTANCE}"
    local GCS_PATH="${GCS_BUCKET}/${GCS_CONFIG_PREFIX}/${INSTANCE}/.env"
    if gsutil cp "${GCS_PATH}" "${TEMP_DIR}/${INSTANCE}/.env" 2>/dev/null; then
      echo "  ${INSTANCE}/.env ✓"
    else
      echo "  ERROR: ${GCS_PATH} not found. Run './deploy-config.sh push' first."
      exit 1
    fi
  done
  echo ""

  # --- Copy git-tracked config files into temp dir ---
  echo "→ Combining with git-tracked config files..."
  for INSTANCE in "${INSTANCES[@]}"; do
    local CONFIG_DIR="${SCRIPT_DIR}/config/${INSTANCE}"
    for f in librechat.yaml docker-compose.override.yml; do
      if [ -f "${CONFIG_DIR}/${f}" ]; then
        cp "${CONFIG_DIR}/${f}" "${TEMP_DIR}/${INSTANCE}/${f}"
        echo "  ${INSTANCE}/${f} ✓"
      else
        echo "  ERROR: Missing ${CONFIG_DIR}/${f}"
        exit 1
      fi
    done
  done
  echo ""

  # --- Check for unfilled placeholders ---
  for INSTANCE in "${INSTANCES[@]}"; do
    echo "→ Checking ${INSTANCE} for unfilled placeholders..."
    REQUIRED_UNFILLED=$(grep '<FILL_IN>' "${TEMP_DIR}/${INSTANCE}/.env" | grep -vc 'FILL_IN_OR_LEAVE' || true)
    OPTIONAL_UNFILLED=$(grep -c 'FILL_IN_OR_LEAVE' "${TEMP_DIR}/${INSTANCE}/.env" || true)

    if [ "${OPTIONAL_UNFILLED}" -gt 0 ]; then
      echo "  ${OPTIONAL_UNFILLED} optional provider(s) not configured (OK to skip)"
    fi

    if [ "${REQUIRED_UNFILLED}" -gt 0 ]; then
      echo ""
      echo "  WARNING: ${REQUIRED_UNFILLED} REQUIRED value(s) still set to <FILL_IN> in ${INSTANCE}:"
      grep -n '<FILL_IN>' "${TEMP_DIR}/${INSTANCE}/.env" | grep -v 'FILL_IN_OR_LEAVE' | sed 's/^/    /'
      echo ""
      read -p "  Continue anyway? (y/N) " -n 1 -r
      echo
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "  Aborted. Fill in your .env values and push to GCS first."
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
    if [ "${MODE}" = "gcloud" ]; then
      READY=$(gcloud compute ssh scout-coach-vm --zone=us-east4-b \
        --command="test -f /opt/scoutcoach/.cloud-init-complete && echo yes || echo no" 2>/dev/null || echo "no")
    else
      READY=$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "ubuntu@${MODE}" \
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

  # --- Upload combined config to VM ---
  echo ""
  echo "→ Uploading config files..."
  if [ "${MODE}" = "gcloud" ]; then
    for INSTANCE in "${INSTANCES[@]}"; do
      gcloud compute scp --recurse "${TEMP_DIR}/${INSTANCE}" \
        "scout-coach-vm:/tmp/scout-config-${INSTANCE}" --zone=us-east4-b
      echo "  ${INSTANCE} uploaded ✓"
    done
  else
    for INSTANCE in "${INSTANCES[@]}"; do
      ssh -o StrictHostKeyChecking=no "ubuntu@${MODE}" "mkdir -p /tmp/scout-config-${INSTANCE}"
      scp -o StrictHostKeyChecking=no -r "${TEMP_DIR}/${INSTANCE}/." \
        "ubuntu@${MODE}:/tmp/scout-config-${INSTANCE}/"
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

  if [ "${MODE}" = "gcloud" ]; then
    gcloud compute ssh scout-coach-vm --zone=us-east4-b --command="${REMOTE_SCRIPT}"
  else
    ssh -o StrictHostKeyChecking=no "ubuntu@${MODE}" "${REMOTE_SCRIPT}"
  fi

  echo ""
  echo "============================================"
  echo "Deployment complete!"
  echo "============================================"
  echo ""

  DOMAIN_AICHAT=$(grep "^DOMAIN_CLIENT=" "${TEMP_DIR}/ai-chat/.env" | cut -d= -f2)
  DOMAIN_SCOUT=$(grep "^DOMAIN_CLIENT=" "${TEMP_DIR}/scout-quest/.env" | cut -d= -f2)

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
  echo "  6. Push updated .env: ./deploy-config.sh push"
  echo "  7. Re-deploy: ./deploy-config.sh gcloud"
  echo ""
  echo "USEFUL COMMANDS (SSH in first: gcloud compute ssh scout-coach-vm --zone=us-east4-b):"
  echo "  AI Chat logs:      cd /opt/scoutcoach/ai-chat && docker compose logs -f api"
  echo "  Scout Quest logs:  cd /opt/scoutcoach/scout-quest && docker compose logs -f api"
  echo "  Restart ai-chat:   cd /opt/scoutcoach/ai-chat && docker compose restart"
  echo "  Restart scout:     cd /opt/scoutcoach/scout-quest && docker compose restart"
  echo "  Caddy logs:        sudo journalctl -u caddy -f"
  echo ""
}

# --- Route subcommand ---
case "${1:-}" in
  push)
    gcs_push
    ;;
  pull)
    gcs_pull
    ;;
  gcloud|*.*.*.*)
    deploy "$1"
    ;;
  "")
    echo "Usage: ./deploy-config.sh <subcommand>"
    echo ""
    echo "  push              Upload local .env files to GCS"
    echo "  pull              Download .env files from GCS to local"
    echo "  <VM_IP>           Deploy to VM (pulls .env from GCS first)"
    echo "  gcloud            Deploy to VM via gcloud SSH"
    exit 1
    ;;
  *)
    # Assume it's an IP address or hostname
    deploy "$1"
    ;;
esac
