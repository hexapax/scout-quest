#!/bin/bash
# ============================================
# setup-claude.sh — Post-terraform VM setup
# ============================================
# Run this after terraform apply + cloud-init completes.
# Configures the devbox for autonomous Claude Code operation.
#
# Usage: bash devbox/scripts/setup-claude.sh
# (Run from repo root — it SSHes into the VM)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEVBOX_DIR="${SCRIPT_DIR}/.."
TFVARS="${DEVBOX_DIR}/terraform/terraform.tfvars"
ENV_FILE="${DEVBOX_DIR}/config/.env"

# --- Validate prerequisites ---
if [ ! -f "${TFVARS}" ]; then
  echo "Error: terraform.tfvars not found. Run terraform first."
  exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
  echo "Warning: devbox/config/.env not found. Will pull secrets from Secret Manager on VM."
  echo "Copy .env.example to .env for non-secret config (git name/email, chat ID)."
fi

PROJECT_ID=$(grep '^project_id' "${TFVARS}" | sed 's/.*= *"\(.*\)"/\1/')
ZONE=$(grep '^zone' "${TFVARS}" | sed 's/.*= *"\(.*\)"/\1/')

SSH_CMD="gcloud compute ssh devbox-vm --zone=${ZONE} --project=${PROJECT_ID} --tunnel-through-iap"
SCP_CMD="gcloud compute scp --zone=${ZONE} --project=${PROJECT_ID} --tunnel-through-iap"

echo "============================================"
echo "DevBox — Post-Terraform Setup"
echo "Project: ${PROJECT_ID}"
echo "============================================"
echo ""

# --- Wait for cloud-init ---
echo "→ Waiting for cloud-init to complete..."
for i in $(seq 1 60); do
  if ${SSH_CMD} -- "test -f /opt/devbox/.cloud-init-complete" 2>/dev/null; then
    echo "  cloud-init complete ✓"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "  ⚠ Timeout waiting for cloud-init (5 min). Check VM logs."
    exit 1
  fi
  sleep 5
done

# --- Upload .env file (non-secret config) ---
if [ -f "${ENV_FILE}" ]; then
  echo "→ Uploading .env..."
  ${SCP_CMD} "${ENV_FILE}" devbox-vm:/tmp/devbox.env
  ${SSH_CMD} -- "sudo mv /tmp/devbox.env /opt/devbox/config/.env && sudo chown devuser:devuser /opt/devbox/config/.env && sudo chmod 600 /opt/devbox/config/.env"
  echo "  .env uploaded ✓"
fi

# --- Pull secrets from Secret Manager ---
echo "→ Fetching secrets from Secret Manager..."
${SSH_CMD} -- bash -c "'
  sudo mkdir -p /opt/devbox/config
  # Telegram bot token
  TELEGRAM_TOKEN=\$(gcloud secrets versions access latest --secret=hexapax-devbot-token --project=${PROJECT_ID} 2>/dev/null || true)
  if [ -z \"\${TELEGRAM_TOKEN}\" ]; then
    echo \"  ⚠ Could not fetch hexapax-devbot-token from Secret Manager\"
  else
    echo \"  hexapax-devbot-token fetched ✓\"
  fi
  # Merge secrets into .env (create if missing, update if exists)
  ENV=/opt/devbox/config/.env
  sudo touch \${ENV}
  if [ -n \"\${TELEGRAM_TOKEN}\" ]; then
    if grep -q \"^TELEGRAM_BOT_TOKEN=\" \${ENV} 2>/dev/null; then
      sudo sed -i \"s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=\${TELEGRAM_TOKEN}|\" \${ENV}
    else
      echo \"TELEGRAM_BOT_TOKEN=\${TELEGRAM_TOKEN}\" | sudo tee -a \${ENV} > /dev/null
    fi
  fi
  sudo chown devuser:devuser \${ENV}
  sudo chmod 600 \${ENV}
'"
echo "  Secrets configured ✓"

# --- Upload hooks ---
echo "→ Uploading hooks..."
${SCP_CMD} "${DEVBOX_DIR}/hooks/permission-gate.sh" devbox-vm:/tmp/permission-gate.sh
${SCP_CMD} "${DEVBOX_DIR}/hooks/notify.sh" devbox-vm:/tmp/notify.sh
${SSH_CMD} -- "sudo mv /tmp/permission-gate.sh /tmp/notify.sh /opt/devbox/hooks/ && sudo chown devuser:devuser /opt/devbox/hooks/*.sh && sudo chmod +x /opt/devbox/hooks/*.sh"
echo "  Hooks uploaded ✓"

# --- Upload Claude Code settings ---
echo "→ Uploading Claude Code config..."
${SCP_CMD} "${DEVBOX_DIR}/config/settings.json" devbox-vm:/tmp/claude-settings.json
${SCP_CMD} "${DEVBOX_DIR}/config/CLAUDE.md" devbox-vm:/tmp/devbox-CLAUDE.md
${SSH_CMD} -- bash -c "'
  sudo -u devuser mkdir -p /home/devuser/.claude
  sudo mv /tmp/claude-settings.json /home/devuser/.claude/settings.json
  sudo mv /tmp/devbox-CLAUDE.md /opt/devbox/config/CLAUDE.md
  sudo chown devuser:devuser /home/devuser/.claude/settings.json /opt/devbox/config/CLAUDE.md
'"
echo "  Claude Code config uploaded ✓"

# --- Clone scout-quest repo ---
echo "→ Cloning scout-quest repo..."
${SSH_CMD} -- bash -c "'
  if [ -d /home/devuser/scout-quest ]; then
    echo \"  Repo already cloned\"
  else
    sudo -u devuser git clone https://github.com/hexapax/scout-quest.git /home/devuser/scout-quest
  fi
'"
echo "  Repo cloned ✓"

# --- Configure git ---
echo "→ Configuring git..."
${SSH_CMD} -- bash -c "'
  source /opt/devbox/config/.env
  sudo -u devuser git -C /home/devuser/scout-quest config user.name \"\${GIT_USER_NAME}\"
  sudo -u devuser git -C /home/devuser/scout-quest config user.email \"\${GIT_USER_EMAIL}\"
'"
echo "  Git configured ✓"

# --- Claude Code OAuth login (uses Max plan tokens) ---
echo ""
echo "============================================"
echo "Claude Code OAuth Login"
echo "============================================"
echo ""
echo "You'll now SSH into the VM to run 'claude login' as devuser."
echo "This authenticates Claude Code with your Max plan so the devbox"
echo "uses your subscription tokens instead of API billing."
echo ""
echo "  1. A URL will appear — open it in your browser (phone works)"
echo "  2. Sign in with your Anthropic account"
echo "  3. Authorize the CLI"
echo "  4. Return here — the session will continue automatically"
echo ""
read -p "Press Enter to SSH in and start login... "
${SSH_CMD} -- "sudo -u devuser bash -c 'source /home/devuser/.nvm/nvm.sh && claude login'"
echo ""
echo "  Claude Code authenticated ✓"

# --- Upload and install telegram bot ---
echo "→ Setting up Telegram bot..."
${SCP_CMD} --recurse "${DEVBOX_DIR}/telegram-bot/" devbox-vm:/tmp/telegram-bot/
${SSH_CMD} -- bash -c "'
  sudo rm -rf /opt/devbox/telegram-bot
  sudo mv /tmp/telegram-bot /opt/devbox/telegram-bot
  sudo chown -R devuser:devuser /opt/devbox/telegram-bot
  cd /opt/devbox/telegram-bot
  sudo -u devuser bash -c \"source /home/devuser/.nvm/nvm.sh && npm install && npm run build\"
'"
echo "  Telegram bot installed ✓"

# --- Create systemd service for telegram bot ---
echo "→ Creating systemd service..."
${SSH_CMD} -- bash -c "'
  sudo tee /etc/systemd/system/devbox-telegram.service > /dev/null << SERVICEEOF
[Unit]
Description=DevBox Telegram Bot
After=network.target

[Service]
Type=simple
User=devuser
WorkingDirectory=/opt/devbox/telegram-bot
EnvironmentFile=/opt/devbox/config/.env
ExecStart=$(sudo -u devuser bash -c 'source /home/devuser/.nvm/nvm.sh && which node') dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF
  sudo systemctl daemon-reload
  sudo systemctl enable devbox-telegram
  sudo systemctl start devbox-telegram
'"
echo "  Telegram bot service started ✓"

echo ""
echo "============================================"
echo "DevBox setup complete!"
echo "============================================"
echo ""
echo "Send /status to your Telegram bot to verify."
echo "Send /run \"echo hello\" to test Claude Code."
echo ""
