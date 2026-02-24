# ============================================
# Identity-Aware Proxy — access control
# ============================================

resource "google_iap_web_backend_service_iam_member" "devbox_admin" {
  provider            = google-beta
  web_backend_service = google_compute_backend_service.devbox.name
  role                = "roles/iap.httpsResourceAccessor"
  member              = "user:${var.iap_admin_email}"
}

# ============================================
# Cross-Project IAM — devbox SA in other projects
# ============================================

data "google_compute_default_service_account" "devbox" {
}

resource "google_project_iam_member" "devbox_sa_scout_editor" {
  project = var.scout_project_id
  role    = "roles/editor"
  member  = "serviceAccount:${data.google_compute_default_service_account.devbox.email}"
}

resource "google_project_iam_member" "devbox_sa_dns_admin" {
  project = var.dns_project_id
  role    = "roles/dns.admin"
  member  = "serviceAccount:${data.google_compute_default_service_account.devbox.email}"
}

resource "google_project_iam_member" "devbox_sa_scout_storage" {
  project = var.scout_project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${data.google_compute_default_service_account.devbox.email}"
}
