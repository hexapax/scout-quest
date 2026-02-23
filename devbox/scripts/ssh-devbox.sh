#!/bin/bash
# ============================================
# ssh-devbox.sh — Convenience SSH wrapper for the devbox VM
# ============================================
# Usage:
#   ./scripts/ssh-devbox.sh              # Interactive SSH
#   ./scripts/ssh-devbox.sh "command"    # Run a command

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TFVARS="${SCRIPT_DIR}/../terraform/terraform.tfvars"

# Read project_id and zone from terraform.tfvars
if [ ! -f "${TFVARS}" ]; then
  echo "Error: ${TFVARS} not found. Run terraform first."
  exit 1
fi

PROJECT_ID=$(grep '^project_id' "${TFVARS}" | sed 's/.*= *"\(.*\)"/\1/')
ZONE=$(grep '^zone' "${TFVARS}" | sed 's/.*= *"\(.*\)"/\1/')

if [ $# -eq 0 ]; then
  # Interactive SSH
  gcloud compute ssh devbox-vm --zone="${ZONE}" --project="${PROJECT_ID}" --tunnel-through-iap
else
  # Run command
  gcloud compute ssh devbox-vm --zone="${ZONE}" --project="${PROJECT_ID}" --tunnel-through-iap -- "$@"
fi
