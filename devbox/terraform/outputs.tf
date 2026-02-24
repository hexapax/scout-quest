output "ssh_command" {
  description = "SSH into the devbox VM via IAP tunnel"
  value       = "gcloud compute ssh devbox-vm --zone=${var.zone} --project=${var.project_id} --tunnel-through-iap"
}

output "instance_name" {
  description = "VM instance name"
  value       = google_compute_instance.devbox.name
}

output "internal_ip" {
  description = "Internal IP address"
  value       = google_compute_instance.devbox.network_interface[0].network_ip
}

output "lb_ip" {
  description = "Load balancer external IP"
  value       = google_compute_global_address.devbox_lb.address
}

output "devbox_url" {
  description = "IAP-protected URL for LibreChat"
  value       = "https://${var.domain_devbox}"
}

output "devbox_sa_email" {
  description = "VM service account email (for cross-project IAM)"
  value       = data.google_compute_default_service_account.devbox.email
}
