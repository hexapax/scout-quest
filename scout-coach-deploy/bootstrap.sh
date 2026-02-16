#!/bin/bash
# ============================================
# bootstrap.sh — Run ONCE before terraform init
# ============================================
# This creates the prerequisites that Terraform itself needs:
#   1. Enables required GCP APIs
#   2. Creates GCS bucket for Terraform state
#   3. Creates service account with minimum permissions
#   4. Downloads service account key
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - A GCP project already created in hexapax.com console
#
# Usage: ./bootstrap.sh <PROJECT_ID>
# Example: ./bootstrap.sh scout-coach

set -euo pipefail

PROJECT_ID="${1:?Usage: ./bootstrap.sh <PROJECT_ID>}"
REGION="us-east4"
SA_NAME="scout-deployer"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KEY_PATH="$HOME/.config/gcloud/scout-deployer-key.json"
BUCKET_NAME="${PROJECT_ID}-tfstate"

echo "============================================"
echo "Scout Coach — GCP Bootstrap"
echo "Project: ${PROJECT_ID}"
echo "Region:  ${REGION}"
echo "============================================"
echo ""

# --- Set active project ---
echo "→ Setting active project..."
gcloud config set project "${PROJECT_ID}"

# --- Enable APIs ---
echo "→ Enabling required APIs..."
gcloud services enable \
  compute.googleapis.com \
  storage.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com \
  --quiet

echo "  APIs enabled ✓"

# --- Create Terraform state bucket ---
echo "→ Creating Terraform state bucket: gs://${BUCKET_NAME}"
if gsutil ls -b "gs://${BUCKET_NAME}" &>/dev/null; then
  echo "  Bucket already exists ✓"
else
  gsutil mb -p "${PROJECT_ID}" -l "${REGION}" -b on "gs://${BUCKET_NAME}"
  gsutil versioning set on "gs://${BUCKET_NAME}"
  echo "  Bucket created with versioning ✓"
fi

# --- Create service account ---
echo "→ Creating service account: ${SA_NAME}"
if gcloud iam service-accounts describe "${SA_EMAIL}" &>/dev/null 2>&1; then
  echo "  Service account already exists ✓"
else
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="Scout Coach Deployer" \
    --quiet
  echo "  Service account created ✓"
fi

# --- Grant roles ---
echo "→ Granting IAM roles..."
ROLES=(
  "roles/compute.admin"        # Create/manage VMs, IPs, firewall
  "roles/storage.admin"        # Terraform state in GCS
  "roles/iam.serviceAccountUser" # Attach SA to VM
)

for ROLE in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null 2>&1
  echo "  ${ROLE} ✓"
done

# --- Download key ---
echo "→ Downloading service account key..."
mkdir -p "$(dirname "${KEY_PATH}")"
if [ -f "${KEY_PATH}" ]; then
  echo "  Key already exists at ${KEY_PATH}"
  read -p "  Overwrite? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "  Keeping existing key ✓"
  else
    gcloud iam service-accounts keys create "${KEY_PATH}" \
      --iam-account="${SA_EMAIL}" --quiet
    echo "  Key saved to ${KEY_PATH} ✓"
  fi
else
  gcloud iam service-accounts keys create "${KEY_PATH}" \
    --iam-account="${SA_EMAIL}" --quiet
  echo "  Key saved to ${KEY_PATH} ✓"
fi

echo ""
echo "============================================"
echo "Bootstrap complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo ""
echo "  1. Copy terraform.tfvars.example → terraform.tfvars"
echo "     cp terraform/terraform.tfvars.example terraform/terraform.tfvars"
echo ""
echo "  2. Edit terraform.tfvars with your values:"
echo "     - project_id = \"${PROJECT_ID}\""
echo "     - credentials_file = \"${KEY_PATH}\""
echo "     - domain = \"scout.hexapax.com\""
echo ""
echo "  3. Update the GCS backend bucket name in terraform/main.tf"
echo "     if your project ID is not 'scout-coach':"
echo "     backend \"gcs\" { bucket = \"${BUCKET_NAME}\" }"
echo ""
echo "  4. Run Terraform:"
echo "     cd terraform"
echo "     terraform init"
echo "     terraform plan"
echo "     terraform apply"
echo ""
echo "  5. After apply, note the external IP and update DNS:"
echo "     scout.hexapax.com → <IP from terraform output>"
echo ""
echo "  6. Fill in config/.env with your API keys, then run:"
echo "     ./deploy-config.sh <IP>"
echo ""
