# --- VM Instance ---
resource "google_compute_instance" "devbox" {
  name         = "devbox-vm"
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
    # No access_config — no external IP (org policy blocks it)
    # SSH via IAP tunnel: gcloud compute ssh --tunnel-through-iap
  }

  metadata = {
    user-data = file("${path.module}/cloud-init.yaml")
  }

  tags = ["devbox"]

  service_account {
    scopes = ["cloud-platform"]
  }

  lifecycle {
    create_before_destroy = true
  }
}
