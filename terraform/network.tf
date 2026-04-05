# --- VPC ---
resource "google_compute_network" "vpc" {
  name                    = "scout-coach-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet" {
  name          = "scout-coach-subnet"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

# --- Firewall: HTTP/HTTPS ---
# Only ports 80 and 443 are intentionally open to the internet.
# Application ports (3080, 3081, 3082, 4180, 8081) are NOT listed here
# and are therefore blocked at the GCP network level by default-deny policy.
# A second layer of defence is provided by ufw on the VM itself (see cloud-init.yaml).
resource "google_compute_firewall" "allow_web" {
  name    = "scout-coach-allow-web"
  network = google_compute_network.vpc.id

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["scout-coach"]
}

# --- Firewall: SSH ---
resource "google_compute_firewall" "allow_ssh" {
  name    = "scout-coach-allow-ssh"
  network = google_compute_network.vpc.id

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = var.ssh_source_ranges
  target_tags   = ["scout-coach"]
}

# --- Firewall: explicit deny for application ports ---
# GCP is default-deny so these ports are already blocked, but this rule makes
# the intent machine-readable and auditable. Priority 900 < default allow (1000)
# so it overrides any accidental broad allow rules added in future.
resource "google_compute_firewall" "deny_app_ports" {
  name     = "scout-coach-deny-app-ports"
  network  = google_compute_network.vpc.id
  priority = 900
  direction = "INGRESS"

  deny {
    protocol = "tcp"
    ports    = ["3080", "3081", "3082", "4180", "8081"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["scout-coach"]
}
