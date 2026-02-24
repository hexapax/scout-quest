#!/usr/bin/env bash
# deploy-librechat.sh — Deploy LibreChat to devbox VM
# Usage: bash devbox/scripts/deploy-librechat.sh
set -euo pipefail

PROJECT="hexapax-devbox"
ZONE="us-east4-b"
VM="devbox-vm"
REMOTE_USER="devuser"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

ssh_cmd() {
  gcloud compute ssh "$VM" \
    --zone="$ZONE" \
    --project="$PROJECT" \
    --tunnel-through-iap \
    --command="$1"
}

scp_cmd() {
  gcloud compute scp "$1" "$VM:$2" \
    --zone="$ZONE" \
    --project="$PROJECT" \
    --tunnel-through-iap
}

echo "=== Step 1: Upload scripts and config ==="
scp_cmd "$REPO_ROOT/devbox/scripts/setup-librechat.sh" "/tmp/setup-librechat.sh"
scp_cmd "$REPO_ROOT/devbox/config/librechat.service" "/tmp/librechat.service"
scp_cmd "$REPO_ROOT/config/devbox/librechat.yaml" "/tmp/librechat.yaml"

echo "=== Step 2: Run setup script as devuser ==="
ssh_cmd "chmod +x /tmp/setup-librechat.sh && sudo -u $REMOTE_USER bash /tmp/setup-librechat.sh"

echo "=== Step 2b: Install Playwright system deps (requires root) ==="
ssh_cmd "source /home/$REMOTE_USER/.nvm/nvm.sh && npx playwright install-deps chromium" || echo "WARNING: Playwright deps install failed (non-fatal)"

echo "=== Step 3: Copy librechat.yaml ==="
ssh_cmd "sudo -u $REMOTE_USER cp /tmp/librechat.yaml /home/$REMOTE_USER/LibreChat/librechat.yaml"

echo "=== Step 4: Install systemd service ==="
ssh_cmd "sudo cp /tmp/librechat.service /etc/systemd/system/librechat.service && sudo systemctl daemon-reload && sudo systemctl enable librechat"

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Remaining manual steps:"
echo "  1. SSH in: gcloud compute ssh $VM --zone=$ZONE --project=$PROJECT --tunnel-through-iap"
echo "  2. Create .env: sudo -u devuser cp /home/devuser/LibreChat/.env.example /home/devuser/LibreChat/.env"
echo "  3. Fill in API keys in .env"
echo "  4. Auth Claude Code: sudo -u devuser -i claude login"
echo "  5. Accept permissions: sudo -u devuser -i claude --dangerously-skip-permissions (then Ctrl+C after accepting)"
echo "  6. Start: sudo systemctl start librechat"
echo "  7. Verify: curl -s http://localhost:3080/api/health"
echo "  8. Access: https://devbox.hexapax.com (after SSL cert provisions)"
