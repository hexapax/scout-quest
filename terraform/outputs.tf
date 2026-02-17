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
  description = "DNS records managed by Terraform"
  value       = "A records created: ${var.domain_aichat} + ${var.domain_scout} → ${google_compute_address.static.address}"
}

output "dns_nameservers" {
  description = "Nameservers for hexapax.com (managed in hexapax-web)"
  value       = data.google_dns_managed_zone.hexapax.name_servers
}
