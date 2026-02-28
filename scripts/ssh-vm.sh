#!/bin/bash
# SSH to the VM and run a command
# Usage: ./scripts/ssh-vm.sh "command to run"
# Example: ./scripts/ssh-vm.sh "docker ps"
#          ./scripts/ssh-vm.sh "cd /opt/scoutcoach/admin && docker compose logs"

set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: ./scripts/ssh-vm.sh \"command\""
  exit 1
fi

gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --command="$1"
