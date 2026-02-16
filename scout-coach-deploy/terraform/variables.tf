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

variable "domain" {
  description = "Domain for the Scout Coach app (e.g., scout.hexapax.com)"
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

variable "ssh_source_ranges" {
  description = "CIDR ranges allowed to SSH (tighten to your IP for security)"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
