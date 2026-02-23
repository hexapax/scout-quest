terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # State stored in GCS. Create the bucket first with bootstrap.sh
  backend "gcs" {
    bucket = "hexapax-devbox-tfstate"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  # Uses Application Default Credentials (gcloud auth application-default login)
  # No SA key needed — org policy blocks key creation
}
