variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-east4"
}

variable "zone" {
  description = "GCP zone"
  type        = string
  default     = "us-east4-b"
}

variable "machine_type" {
  description = "GCE machine type"
  type        = string
  default     = "e2-standard-4"
}

variable "disk_size_gb" {
  description = "Boot disk size in GB"
  type        = number
  default     = 50
}

variable "ssh_source_ranges" {
  description = "CIDR ranges allowed to SSH (tighten to your IP for security)"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "ssh_pub_key_path" {
  description = "Path to SSH public key for VM access"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "dns_zone_name" {
  description = "Cloud DNS managed zone name"
  type        = string
  default     = "hexapax-com"
}

variable "dns_project_id" {
  description = "GCP project that owns the Cloud DNS zone"
  type        = string
  default     = "hexapax-web"
}

variable "domain_devbox" {
  description = "Domain for the devbox LibreChat instance"
  type        = string
  default     = "devbox.hexapax.com"
}

variable "iap_admin_email" {
  description = "Email address allowed through IAP"
  type        = string
  default     = "jeremy@hexapax.com"
}

variable "scout_project_id" {
  description = "Scout Quest GCP project ID for cross-project IAM"
  type        = string
  default     = "scout-assistant-487523"
}
