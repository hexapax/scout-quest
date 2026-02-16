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
