#!/bin/bash
# Deploy the MCP server to the VM
# Usage: ./scripts/deploy-mcp.sh
#
# Builds locally, tars dist/+node_modules/+package.json, SCPs to VM,
# extracts into both instance directories, restarts API containers.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MCP_DIR="$SCRIPT_DIR/../mcp-servers/scout-quest"

echo "=== Building MCP server ==="
cd "$MCP_DIR"
source ~/.nvm/nvm.sh
nvm use 24 2>/dev/null
npx tsc
echo "Build complete"

echo ""
echo "=== Creating tarball ==="
tar czf /tmp/mcp-bundle.tar.gz dist/ node_modules/ package.json
echo "Tarball: /tmp/mcp-bundle.tar.gz"

echo ""
echo "=== Uploading to VM ==="
gcloud compute scp /tmp/mcp-bundle.tar.gz scout-coach-vm:/tmp/mcp-bundle.tar.gz --zone=us-east4-b

echo ""
echo "=== Extracting and restarting ==="
gcloud compute ssh scout-coach-vm --zone=us-east4-b --command="
set -e
for INSTANCE in ai-chat scout-quest; do
  MCP_PATH=/opt/scoutcoach/\$INSTANCE/mcp-servers/scout-quest
  echo \"  Extracting to \$INSTANCE...\"
  sudo -u scoutcoach mkdir -p \$MCP_PATH
  sudo -u scoutcoach tar xzf /tmp/mcp-bundle.tar.gz -C \$MCP_PATH
  echo \"  Restarting \$INSTANCE API...\"
  cd /opt/scoutcoach/\$INSTANCE
  sudo -u scoutcoach docker compose restart api
done
rm /tmp/mcp-bundle.tar.gz
echo \"\"
echo \"MCP server deployed and API containers restarted\"
"

rm /tmp/mcp-bundle.tar.gz 2>/dev/null || true

echo ""
echo "=== Waiting for API containers to initialize ==="
sleep 10

echo ""
echo "=== Checking MCP initialization ==="
gcloud compute ssh scout-coach-vm --zone=us-east4-b --command="
cd /opt/scoutcoach/ai-chat && sudo -u scoutcoach docker compose logs api --tail=20 2>&1 | grep -E 'MCP|tools|error' || true
echo '---'
cd /opt/scoutcoach/scout-quest && sudo -u scoutcoach docker compose logs api --tail=20 2>&1 | grep -E 'MCP|tools|error' || true
"

echo ""
echo "Done!"
