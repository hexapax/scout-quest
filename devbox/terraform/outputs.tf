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
