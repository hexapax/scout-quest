#!/bin/bash
# Path B: Tiered admin SA + gcloud-config impersonation.
#
# Architecture:
#   - "default" mode: devbox uses its attached SA (low-privilege baseline)
#   - "admin" mode:   gcloud auto-impersonates claude-admin@hexapax-devbox SA,
#                     which holds the cross-project elevated permissions.
#
# BENEFITS over Path A:
#   - Default SA never gets the elevated cross-project perms — smaller blast
#     radius if a routine task or compromised process touches it.
#   - Audit logs attribute calls to BOTH the impersonator and the SA, so you
#     can see exactly when/why elevation happened.
#   - No interactive `gcloud auth login` reauth ever — impersonation refreshes
#     off the metadata-server token, which doesn't expire.
#   - Easy mode-switching: `gcloud config configurations activate {default,admin}`.
#
# TRADEOFF: more moving parts up-front; you (or scripts) must remember to
# activate admin mode for elevated work. Mitigate with a wrapper alias.

set -euo pipefail

DEVBOX_PROJECT=hexapax-devbox
TARGET_PROJECT=scout-assistant-487523
TARGET_VM=scout-coach-vm
TARGET_ZONE=us-east4-b

HUMAN=jeremy@hexapax.com
DEVBOX_SA=856219795903-compute@developer.gserviceaccount.com

ADMIN_SA_NAME=claude-admin
ADMIN_SA_EMAIL="${ADMIN_SA_NAME}@${DEVBOX_PROJECT}.iam.gserviceaccount.com"

# ---------------------------------------------------------------------------
# 1. Create the admin SA (idempotent — skips if it exists)
# ---------------------------------------------------------------------------
if ! gcloud iam service-accounts describe "${ADMIN_SA_EMAIL}" \
     --project="${DEVBOX_PROJECT}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${ADMIN_SA_NAME}" \
    --project="${DEVBOX_PROJECT}" \
    --display-name='Claude admin (cross-project elevated)' \
    --description='Used via impersonation for cross-project ops. Do not attach to a resource.'
else
  echo "Admin SA already exists: ${ADMIN_SA_EMAIL}"
fi

# ---------------------------------------------------------------------------
# 2. Grant admin SA the cross-project perms it needs
# ---------------------------------------------------------------------------
gcloud projects add-iam-policy-binding "${TARGET_PROJECT}" \
  --member="serviceAccount:${ADMIN_SA_EMAIL}" \
  --role=roles/iap.tunnelResourceAccessor \
  --condition=None

gcloud projects add-iam-policy-binding "${TARGET_PROJECT}" \
  --member="serviceAccount:${ADMIN_SA_EMAIL}" \
  --role=roles/compute.osAdminLogin \
  --condition=None

VM_SA=$(gcloud compute instances describe "${TARGET_VM}" \
  --zone="${TARGET_ZONE}" --project="${TARGET_PROJECT}" \
  --format='value(serviceAccounts[0].email)')
echo "VM service account: ${VM_SA}"

gcloud iam service-accounts add-iam-policy-binding "${VM_SA}" \
  --project="${TARGET_PROJECT}" \
  --member="serviceAccount:${ADMIN_SA_EMAIL}" \
  --role=roles/iam.serviceAccountUser

# ---------------------------------------------------------------------------
# 3. Allow the human + devbox default SA to impersonate the admin SA
# ---------------------------------------------------------------------------
# Human can impersonate from anywhere they're logged in (laptop, desktop, etc.)
gcloud iam service-accounts add-iam-policy-binding "${ADMIN_SA_EMAIL}" \
  --project="${DEVBOX_PROJECT}" \
  --member="user:${HUMAN}" \
  --role=roles/iam.serviceAccountTokenCreator

# Devbox default SA can impersonate, so scripts running on the devbox elevate
# without needing the human's user-creds. THIS IS THE KEY GRANT — it's what
# lets `gcloud config configurations activate admin` work non-interactively.
gcloud iam service-accounts add-iam-policy-binding "${ADMIN_SA_EMAIL}" \
  --project="${DEVBOX_PROJECT}" \
  --member="serviceAccount:${DEVBOX_SA}" \
  --role=roles/iam.serviceAccountTokenCreator

# ---------------------------------------------------------------------------
# 4. Set up gcloud configurations on this devbox
# ---------------------------------------------------------------------------
# Default config keeps current behavior (devbox SA, hexapax-devbox project).
# Admin config impersonates and points at the scout project.
if ! gcloud config configurations list --format='value(name)' | grep -qx admin; then
  gcloud config configurations create admin
fi
gcloud config configurations activate admin
gcloud config set core/project "${TARGET_PROJECT}"
gcloud config set auth/impersonate_service_account "${ADMIN_SA_EMAIL}"
gcloud config configurations activate default

echo ""
echo "Setup complete."
echo ""
echo "Usage:"
echo "  # Flip into admin mode (impersonates ${ADMIN_SA_EMAIL})"
echo "  gcloud config configurations activate admin"
echo ""
echo "  # Run the Scoutbook sync"
echo "  SCOUTBOOK_TOKEN=eyJ... bash /opt/repos/scout-quest/scripts/run-token-sync-vm.sh"
echo ""
echo "  # Drop back to default mode when done"
echo "  gcloud config configurations activate default"
echo ""
echo "Or one-shot per command:"
echo "  gcloud --impersonate-service-account=${ADMIN_SA_EMAIL} compute ssh ..."
