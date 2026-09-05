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
VM_PATH="/opt/scoutcoach/scout-quest/mcp-servers/scout-quest"

# Identity, impersonation and IAP come from the shared lib, same as ssh-vm.sh
# and run-token-sync-vm.sh. This script previously called gcloud bare, so it
# could not reach the VM from the devbox at all. See docs/gcloud-admin-mode.md.
source "${REPO_DIR}/scripts/lib/gcloud-identity.sh"
gcloud_identity_preflight || exit 1
ZONE="$VM_ZONE"

# Per-invocation remote tarball name. Avoids the SCP "Permission denied"
# trap when /tmp/scout-mcp-dist.tar.gz exists owned by a different
# OS-Login user from a previous deploy (e.g. different SA impersonation).
REMOTE_TARBALL="/tmp/scout-mcp-dist-$$-$(date +%s).tar.gz"

echo "============================================"
echo "Deploy scout-quest MCP dist → scout-coach-vm"
echo "============================================"
echo

# Build but don't trust the exit code alone: tsc returns non-zero on any
# type error but still emits dist/ — so an unrelated error elsewhere in
# the tree would block a perfectly-good Scoutbook build. Instead, run
# the build, then verify dist/ is fresher than the newest source file.
echo "→ Building dist locally..."
set +e
bash "${MCP_DIR}/build.sh" 2>&1 | tail -5
BUILD_RC=${PIPESTATUS[0]}
set -e
if [ "${BUILD_RC}" -ne 0 ]; then
  echo "  (build exited ${BUILD_RC} — verifying dist/ regardless before deciding to abort)"
fi

# Verify dist freshness: the newest .js in dist must be at least as new as
# the newest .ts in src. If it isn't, tsc didn't emit and the deploy
# should abort regardless of exit code.
echo "→ Verifying dist freshness..."
SENTINEL="${MCP_DIR}/dist/scoutbook/cli.js"
if [ ! -f "${SENTINEL}" ]; then
  echo "ERROR: ${SENTINEL} not found — refusing to deploy." >&2
  exit 1
fi
DIST_MTIME=$(stat -c %Y "${SENTINEL}")
NEWEST_SRC=$(find "${MCP_DIR}/src" -name "*.ts" -printf "%T@\n" | sort -n | tail -1 | cut -d. -f1)
if [ "${DIST_MTIME}" -lt "${NEWEST_SRC}" ]; then
  echo "ERROR: dist appears older than source." >&2
  echo "  dist/scoutbook/cli.js:    $(date -d "@${DIST_MTIME}" -Iseconds)" >&2
  echo "  newest src/**/*.ts:       $(date -d "@${NEWEST_SRC}" -Iseconds)" >&2
  echo "  Build errors (above) prevented tsc from emitting. Fix them first." >&2
  exit 1
fi
echo "  ✓ dist/ is newer than newest .ts (build emitted successfully)"
echo

echo "→ Packaging dist + package.json + package-lock.json..."
TARBALL_DIR="$(mktemp -d)"
TARBALL="${TARBALL_DIR}/mcp-dist.tar.gz"
tar -czf "${TARBALL}" -C "${MCP_DIR}" dist package.json package-lock.json
echo "  $(ls -lh "${TARBALL}" | awk '{print $5, $9}')"
echo

echo "→ Uploading tarball to VM (${REMOTE_TARBALL})..."
gcloud compute scp "${TARBALL}" "${VM_NAME}:${REMOTE_TARBALL}" \
  --zone="${ZONE}" --project="${PROJECT_ID}" --account="${GCLOUD_ACCOUNT}" --tunnel-through-iap
rm -rf "${TARBALL_DIR}"
echo

echo "→ Unpacking, refreshing deps, restarting containers on VM..."
gcloud compute ssh "${VM_NAME}" --zone="${ZONE}" --project="${PROJECT_ID}" --account="${GCLOUD_ACCOUNT}" --tunnel-through-iap --command="
set -e
MCP=/opt/scoutcoach/scout-quest/mcp-servers/scout-quest
REMOTE_TARBALL='${REMOTE_TARBALL}'
# Backup current dist before overwriting — cheap insurance for rollback.
sudo rm -rf \${MCP}/dist.bak.previous
[ -d \${MCP}/dist ] && sudo cp -a \${MCP}/dist \${MCP}/dist.bak.previous
# Replace dist + package files in place (tar overwrites).
sudo tar -xzf \${REMOTE_TARBALL} -C \${MCP}/
sudo chown -R scoutcoach:scoutcoach \${MCP}/dist \${MCP}/package.json \${MCP}/package-lock.json
# Refresh production dependencies if package.json/lock changed.
sudo -u scoutcoach bash -c \"cd \${MCP} && npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -3\"
# Restart long-lived MCP containers; LibreChat api containers re-spawn
# stdio MCPs on next session so they pick up new code without restart.
cd /opt/scoutcoach/scout-quest && sudo docker compose restart admin-mcp cron 2>&1 | tail -5
sudo rm -f \${REMOTE_TARBALL}
echo
echo '→ Health check (admin-mcp)...'
sleep 3
curl -sS --max-time 5 http://localhost:3083/healthz && echo
"

echo
echo "Done. Previous dist/ retained at ${VM_PATH}/dist.bak.previous"
echo "(safe to delete once new build is verified)."
