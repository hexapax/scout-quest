#!/bin/bash
# ============================================
# bootstrap.sh — Run ONCE before terraform init
# ============================================
# Creates the prerequisites that Terraform needs for the devbox:
#   1. Creates a new GCP project (or reuses existing)
#   2. Links billing account
#   3. Enables required GCP APIs
#   4. Creates GCS bucket for Terraform state
#   5. Creates service account with minimum permissions
#   6. Downloads service account key
#
# Prerequisites:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - Billing account accessible
#
# Usage: ./bootstrap.sh <PROJECT_ID> [BILLING_ACCOUNT_ID]
# Example: ./bootstrap.sh hexapax-devbox 01ABCD-EFGH12-345678

set -euo pipefail

PROJECT_ID="${1:?Usage: ./bootstrap.sh <PROJECT_ID> [BILLING_ACCOUNT_ID]}"
BILLING_ACCOUNT="${2:-}"
REGION="us-east4"
ORG_DOMAIN="hexapax.com"
SA_NAME="devbox-deployer"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BUCKET_NAME="${PROJECT_ID}-tfstate"

echo "============================================"
echo "Devbox — GCP Bootstrap"
echo "Project: ${PROJECT_ID}"
echo "Region:  ${REGION}"
echo "============================================"
echo ""

# --- Create project (if it doesn't exist) ---
echo "→ Checking if project exists..."
if gcloud projects describe "${PROJECT_ID}" &>/dev/null 2>&1; then
  echo "  Project already exists ✓"
else
  echo "→ Creating project..."
  # Get org ID from domain
  ORG_ID=$(gcloud organizations list --filter="displayName=${ORG_DOMAIN}" --format="value(name)" 2>/dev/null || true)
  if [ -n "${ORG_ID}" ]; then
    gcloud projects create "${PROJECT_ID}" \
      --name="Hexapax DevBox" \
      --organization="${ORG_ID}" \
      --quiet
  else
    gcloud projects create "${PROJECT_ID}" \
      --name="Hexapax DevBox" \
      --quiet
  fi
  echo "  Project created ✓"
fi

# --- Set active project ---
echo "→ Setting active project..."
gcloud config set project "${PROJECT_ID}"

# --- Link billing ---
if [ -n "${BILLING_ACCOUNT}" ]; then
  echo "→ Linking billing account..."
  gcloud billing projects link "${PROJECT_ID}" \
    --billing-account="${BILLING_ACCOUNT}" \
    --quiet
  echo "  Billing linked ✓"
else
  echo "→ Checking billing..."
  CURRENT_BILLING=$(gcloud billing projects describe "${PROJECT_ID}" --format="value(billingAccountName)" 2>/dev/null || true)
  if [ -z "${CURRENT_BILLING}" ]; then
    echo "  ⚠ No billing account linked!"
    echo "  Available billing accounts:"
    gcloud billing accounts list
    echo ""
    echo "  Re-run with: ./bootstrap.sh ${PROJECT_ID} <BILLING_ACCOUNT_ID>"
    exit 1
  fi
  echo "  Billing already linked ✓"
fi

# --- Enable APIs ---
echo "→ Enabling required APIs..."
gcloud services enable \
  compute.googleapis.com \
  storage.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iam.googleapis.com \
  secretmanager.googleapis.com \
  iap.googleapis.com \
  --quiet

echo "  APIs enabled ✓"

# --- Create Terraform state bucket ---
echo "→ Creating Terraform state bucket: gs://${BUCKET_NAME}"
if gcloud storage ls --buckets "gs://${BUCKET_NAME}" &>/dev/null 2>&1; then
  echo "  Bucket already exists ✓"
else
  gcloud storage buckets create "gs://${BUCKET_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --uniform-bucket-level-access
  gcloud storage buckets update "gs://${BUCKET_NAME}" --versioning
  echo "  Bucket created with versioning ✓"
fi

# --- Create service account ---
echo "→ Creating service account: ${SA_NAME}"
if gcloud iam service-accounts describe "${SA_EMAIL}" &>/dev/null 2>&1; then
  echo "  Service account already exists ✓"
else
  gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="DevBox Deployer" \
    --quiet
  echo "  Service account created ✓"
fi

# --- Grant roles ---
echo "→ Granting IAM roles..."
ROLES=(
  "roles/compute.admin"
  "roles/storage.admin"
  "roles/iam.serviceAccountUser"
)

for ROLE in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null 2>&1
  echo "  ${ROLE} ✓"
done

# --- Auth: use ADC instead of SA key ---
# Org policy blocks SA key creation (constraints/iam.disableServiceAccountKeyCreation)
# Terraform uses Application Default Credentials instead.
echo "→ Skipping SA key download (org policy blocks key creation)"
echo "  Terraform will use ADC (gcloud auth application-default login)"

echo ""
echo "============================================"
echo "Bootstrap complete!"
echo "============================================"
echo ""
echo "Next steps:"
echo ""
echo "  1. Ensure ADC is set for this project:"
echo "     gcloud auth application-default login"
echo "     gcloud auth application-default set-quota-project ${PROJECT_ID}"
echo ""
echo "  2. Copy terraform.tfvars.example → terraform.tfvars"
echo "     cp devbox/terraform/terraform.tfvars.example devbox/terraform/terraform.tfvars"
echo ""
echo "  3. Edit terraform.tfvars with your values:"
echo "     - project_id = \"${PROJECT_ID}\""
echo ""
echo "  4. Run Terraform:"
echo "     cd devbox/terraform && terraform init && terraform plan && terraform apply"
echo ""
echo "  5. After VM is up, run setup:"
echo "     bash devbox/scripts/setup-claude.sh"
echo ""
