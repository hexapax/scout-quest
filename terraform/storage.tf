# Backup bucket for MongoDB dumps
resource "google_storage_bucket" "backups" {
  name     = "${var.project_id}-backups"
  location = var.region

  uniform_bucket_level_access = true

  lifecycle_rule {
    condition {
      age = 30 # Delete backups older than 30 days
    }
    action {
      type = "Delete"
    }
  }

  versioning {
    enabled = false
  }
}
