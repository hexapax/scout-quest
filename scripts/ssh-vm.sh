#!/bin/bash
# SSH to the VM and run a command
# Usage: ./scripts/ssh-vm.sh "command to run"
# Example: ./scripts/ssh-vm.sh "docker ps"
#          ./scripts/ssh-vm.sh "cd /opt/scoutcoach/admin && docker compose logs"
#
# Identity and IAP tunneling are handled by scripts/lib/gcloud-identity.sh,
# shared with run-token-sync-vm.sh. See docs/gcloud-admin-mode.md for the why.
# Off the devbox, override the base account: GCLOUD_ACCOUNT=jeremy@hexapax.com

set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: ./scripts/ssh-vm.sh \"command\""
  exit 1
fi

source "$(dirname "${BASH_SOURCE[0]}")/lib/gcloud-identity.sh"
gcloud_identity_preflight || exit 1

gcloud compute ssh "$VM_NAME" \
  --zone="$VM_ZONE" \
  --project="$PROJECT_ID" \
  --account="$GCLOUD_ACCOUNT" \
  --tunnel-through-iap \
  --command="$1"
