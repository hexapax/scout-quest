#!/bin/bash
# Path A: Direct grant to devbox default compute SA.
# Adds cross-project perms so scout-coach-vm SSH (via IAP) works without auth dance.
#
# TRADEOFF: roles/compute.osAdminLogin and roles/iap.tunnelResourceAccessor are
# project-scoped — once granted, the devbox default SA can sudo-SSH into ANY VM
# in scout-assistant-487523 (not just scout-coach-vm). Acceptable if the devbox
# is treated as trusted infra; risky if the devbox SA might be compromised.
#
# To narrow blast radius, see the instance-level binding alternative below.

set -euo pipefail

DEVBOX_SA=856219795903-compute@developer.gserviceaccount.com
TARGET_PROJECT=scout-assistant-487523
TARGET_VM=scout-coach-vm
TARGET_ZONE=us-east4-b

echo "Granting cross-project perms to ${DEVBOX_SA} on ${TARGET_PROJECT}..."

# 1. IAP tunnel access (project-level)
gcloud projects add-iam-policy-binding "${TARGET_PROJECT}" \
  --member="serviceAccount:${DEVBOX_SA}" \
  --role=roles/iap.tunnelResourceAccessor \
  --condition=None

# 2. OS Login with sudo (the script runs `sudo -u scoutcoach docker ...`)
gcloud projects add-iam-policy-binding "${TARGET_PROJECT}" \
  --member="serviceAccount:${DEVBOX_SA}" \
  --role=roles/compute.osAdminLogin \
  --condition=None

# 3. Act-as on the VM's attached SA (gcloud compute ssh requires this)
VM_SA=$(gcloud compute instances describe "${TARGET_VM}" \
  --zone="${TARGET_ZONE}" --project="${TARGET_PROJECT}" \
  --format='value(serviceAccounts[0].email)')
echo "VM service account: ${VM_SA}"

gcloud iam service-accounts add-iam-policy-binding "${VM_SA}" \
  --project="${TARGET_PROJECT}" \
  --member="serviceAccount:${DEVBOX_SA}" \
  --role=roles/iam.serviceAccountUser

echo ""
echo "Done. Verify with:"
echo "  gcloud projects get-iam-policy ${TARGET_PROJECT} --flatten='bindings[].members' --filter='bindings.members:${DEVBOX_SA}' --format='value(bindings.role)'"
echo ""
echo "Test:"
echo "  gcloud compute ssh ${TARGET_VM} --zone=${TARGET_ZONE} --project=${TARGET_PROJECT} --tunnel-through-iap --command='echo OK'"

# ---------------------------------------------------------------------------
# NARROWER ALTERNATIVE — instance-level scoping for IAP + OS Login
# ---------------------------------------------------------------------------
# Replaces step 1 + 2 above. Limits SSH/sudo to scout-coach-vm specifically.
# Requires OS Login to be enabled on the instance (check with the describe
# command at the top). Note: roles/compute.osAdminLogin is NOT supported as an
# instance-level binding in all regions — falls back to project-level if so.
#
#   gcloud iap tunnel-instances add-iam-policy-binding "${TARGET_VM}" \
#     --zone="${TARGET_ZONE}" --project="${TARGET_PROJECT}" \
#     --member="serviceAccount:${DEVBOX_SA}" \
#     --role=roles/iap.tunnelResourceAccessor
#
#   gcloud compute instances add-iam-policy-binding "${TARGET_VM}" \
#     --zone="${TARGET_ZONE}" --project="${TARGET_PROJECT}" \
#     --member="serviceAccount:${DEVBOX_SA}" \
#     --role=roles/compute.osAdminLogin
