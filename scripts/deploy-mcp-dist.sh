#!/bin/bash
# Build the scout-quest MCP servers locally and ship the compiled dist
# (plus package.json + package-lock.json) to scout-coach-vm. Restarts the
# long-lived MCP containers so they pick up new code.
#
# Closes #4 — deploy-config.sh ships librechat.yaml + override + .env only,
# never the compiled MCP code, so dist/ on the VM drifts from current main.
# This is separate from deploy-config.sh because it isn't needed on every
# deploy (only when MCP code changed) and pays a ~30-60s build cost that
# config-only deploys shouldn't.
#
# LibreChat api containers spawn MCP stdio servers per session, so they
# pick up new code on next spawn — no restart needed for them. Only the
# long-lived admin-mcp + cron containers hold dist in memory.
#
# Usage:
#   ./scripts/deploy-mcp-dist.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MCP_DIR="${REPO_DIR}/mcp-servers/scout-quest"
PROJECT_ID="scout-assistant-487523"
ZONE="us-east4-b"
VM_PATH="/opt/scoutcoach/scout-quest/mcp-servers/scout-quest"

echo "============================================"
echo "Deploy scout-quest MCP dist → scout-coach-vm"
echo "============================================"
echo

echo "→ Building dist locally..."
bash "${MCP_DIR}/build.sh" 2>&1 | tail -3
echo

echo "→ Packaging dist + package.json + package-lock.json..."
TARBALL_DIR="$(mktemp -d)"
TARBALL="${TARBALL_DIR}/mcp-dist.tar.gz"
tar -czf "${TARBALL}" -C "${MCP_DIR}" dist package.json package-lock.json
echo "  $(ls -lh "${TARBALL}" | awk '{print $5, $9}')"
echo

echo "→ Uploading tarball to VM..."
gcloud compute scp "${TARBALL}" "scout-coach-vm:/tmp/scout-mcp-dist.tar.gz" \
  --zone="${ZONE}" --project="${PROJECT_ID}"
rm -rf "${TARBALL_DIR}"
echo

echo "→ Unpacking, refreshing deps, restarting containers on VM..."
gcloud compute ssh scout-coach-vm --zone="${ZONE}" --project="${PROJECT_ID}" --command='
set -e
MCP=/opt/scoutcoach/scout-quest/mcp-servers/scout-quest
# Backup current dist before overwriting — cheap insurance for rollback.
sudo rm -rf ${MCP}/dist.bak.previous
[ -d ${MCP}/dist ] && sudo cp -a ${MCP}/dist ${MCP}/dist.bak.previous
# Replace dist + package files in place (tar overwrites).
sudo tar -xzf /tmp/scout-mcp-dist.tar.gz -C ${MCP}/
sudo chown -R scoutcoach:scoutcoach ${MCP}/dist ${MCP}/package.json ${MCP}/package-lock.json
# Refresh production dependencies if package.json/lock changed.
sudo -u scoutcoach bash -c "cd ${MCP} && npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -3"
# Restart long-lived MCP containers; LibreChat api containers re-spawn
# stdio MCPs on next session so they pick up new code without restart.
cd /opt/scoutcoach/scout-quest && sudo docker compose restart admin-mcp cron 2>&1 | tail -5
sudo rm -f /tmp/scout-mcp-dist.tar.gz
echo
echo "→ Health check (admin-mcp)..."
sleep 3
curl -sS --max-time 5 http://localhost:3083/healthz && echo
'

echo
echo "Done. Previous dist/ retained at ${VM_PATH}/dist.bak.previous"
echo "(safe to delete once new build is verified)."
