# --- VPC ---
resource "google_compute_network" "vpc" {
  name                    = "devbox-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet" {
  name          = "devbox-subnet"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

# --- Firewall: SSH via IAP only ---
# IAP tunnel uses Google's IP range 35.235.240.0/20
resource "google_compute_firewall" "allow_iap_ssh" {
  name    = "devbox-allow-iap-ssh"
  network = google_compute_network.vpc.id

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["devbox"]
}

# --- Cloud NAT (outbound internet without external IP) ---
resource "google_compute_router" "router" {
  name    = "devbox-router"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "nat" {
  name                               = "devbox-nat"
  router                             = google_compute_router.router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}
