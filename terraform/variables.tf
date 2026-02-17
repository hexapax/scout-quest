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

variable "credentials_file" {
  description = "Path to GCP service account JSON key"
  type        = string
  default     = "~/.config/gcloud/scout-deployer-key.json"
}

variable "domain_aichat" {
  description = "Domain for the full-access AI Chat instance (e.g., ai-chat.hexapax.com)"
  type        = string
}

variable "domain_scout" {
  description = "Domain for the locked-down Scout Quest instance (e.g., scout-quest.hexapax.com)"
  type        = string
}

variable "machine_type" {
  description = "GCE machine type"
  type        = string
  default     = "e2-medium"
}

variable "disk_size_gb" {
  description = "Boot disk size in GB"
  type        = number
  default     = 30
}

variable "dns_zone_name" {
  description = "Cloud DNS managed zone name (e.g., hexapax-com)"
  type        = string
  default     = "hexapax-com"
}

variable "dns_project_id" {
  description = "GCP project that owns the Cloud DNS zone (hexapax-web)"
  type        = string
  default     = "hexapax-web"
}

variable "ssh_source_ranges" {
  description = "CIDR ranges allowed to SSH (tighten to your IP for security)"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
