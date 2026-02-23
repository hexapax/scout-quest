#!/bin/bash
# ============================================
# setup-telegram.sh — Redeploy telegram bot only
# ============================================
# Use this when you've updated the telegram bot code and want to
# rebuild and restart it on the VM without full setup.
#
# Usage: bash devbox/scripts/setup-telegram.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEVBOX_DIR="${SCRIPT_DIR}/.."
TFVARS="${DEVBOX_DIR}/terraform/terraform.tfvars"

PROJECT_ID=$(grep '^project_id' "${TFVARS}" | sed 's/.*= *"\(.*\)"/\1/')
ZONE=$(grep '^zone' "${TFVARS}" | sed 's/.*= *"\(.*\)"/\1/')

SSH_CMD="gcloud compute ssh devbox-vm --zone=${ZONE} --project=${PROJECT_ID} --tunnel-through-iap"
SCP_CMD="gcloud compute scp --zone=${ZONE} --project=${PROJECT_ID} --tunnel-through-iap"

echo "→ Uploading telegram bot..."
${SCP_CMD} --recurse "${DEVBOX_DIR}/telegram-bot/" devbox-vm:/tmp/telegram-bot/

echo "→ Installing and building..."
${SSH_CMD} -- bash -c "'
  sudo systemctl stop devbox-telegram || true
  sudo rm -rf /opt/devbox/telegram-bot
  sudo mv /tmp/telegram-bot /opt/devbox/telegram-bot
  sudo chown -R devuser:devuser /opt/devbox/telegram-bot
  cd /opt/devbox/telegram-bot
  sudo -u devuser bash -c \"source /home/devuser/.nvm/nvm.sh && npm install && npm run build\"
  sudo systemctl start devbox-telegram
'"

echo "→ Telegram bot redeployed ✓"
