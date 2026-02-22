# --- Static IP ---
resource "google_compute_address" "static" {
  name   = "scout-coach-ip"
  region = var.region
}

# --- VM Instance ---
resource "google_compute_instance" "scout_coach" {
  name         = "scout-coach-vm"
  machine_type = var.machine_type
  zone         = var.zone

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = var.disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network    = google_compute_network.vpc.id
    subnetwork = google_compute_subnetwork.subnet.id

    access_config {
      nat_ip = google_compute_address.static.address
    }
  }

  metadata = {
    user-data = templatefile("${path.module}/cloud-init.yaml", {
      domain_aichat = var.domain_aichat
      domain_scout  = var.domain_scout
      domain_admin  = var.domain_admin
    })
  }

  tags = ["scout-coach"]

  # Allow the VM to pull container images, etc.
  service_account {
    scopes = ["cloud-platform"]
  }

  # Ensure VM recreated if cloud-init changes
  lifecycle {
    create_before_destroy = true
  }
}
