output "external_ip" {
  description = "Static external IP address — point your DNS here"
  value       = google_compute_address.static.address
}

output "ssh_command" {
  description = "SSH into the VM"
  value       = "gcloud compute ssh scout-coach-vm --zone=${var.zone} --project=${var.project_id}"
}

output "deploy_command" {
  description = "Run after terraform apply to push config"
  value       = "cd .. && ./deploy-config.sh ${google_compute_address.static.address}"
}

output "dns_instructions" {
  description = "DNS record to create"
  value       = "Create A record: ${var.domain} → ${google_compute_address.static.address}"
}
