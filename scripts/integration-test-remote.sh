#!/bin/bash
# Run integration tests against the v2 backend on the VM via SSH tunnel
# Usage: ./scripts/integration-test-remote.sh
#
# This script:
#   1. Copies integration-test.sh to the VM
#   2. Reads BACKEND_API_KEY from the backend container env
#   3. Runs the tests on the VM (where localhost:3090 is reachable)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${PROJECT_ID:-scout-assistant-487523}"

echo "=== Uploading integration test script to VM ==="
gcloud compute scp "$SCRIPT_DIR/integration-test.sh" \
  "scout-coach-vm:/tmp/integration-test.sh" \
  --zone=us-east4-b --project="$PROJECT_ID" 2>/dev/null

echo "=== Running integration tests on VM ==="
gcloud compute ssh scout-coach-vm --zone=us-east4-b --project="$PROJECT_ID" \
  --command='chmod +x /tmp/integration-test.sh && bash /tmp/integration-test.sh http://localhost:3090' 2>&1

EXIT_CODE=$?
echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "All integration tests passed!"
else
  echo "Some integration tests failed (exit code: $EXIT_CODE)"
fi
exit $EXIT_CODE
