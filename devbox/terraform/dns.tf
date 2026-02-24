# ============================================
# Cloud DNS — devbox.hexapax.com
# ============================================
# The hexapax-com zone lives in the hexapax-web project.
# Same cross-project pattern as terraform/dns.tf in the main project.
#
# FIRST TIME SETUP:
#   Grant ADC user dns.admin on hexapax-web (if not already):
#     gcloud projects add-iam-policy-binding hexapax-web \
#       --member="user:jeremy@hexapax.com" \
#       --role="roles/dns.admin" --condition=None --quiet

data "google_dns_managed_zone" "hexapax" {
  name    = var.dns_zone_name
  project = var.dns_project_id
}

resource "google_dns_record_set" "devbox" {
  project      = var.dns_project_id
  name         = "${var.domain_devbox}."
  type         = "A"
  ttl          = 300
  managed_zone = data.google_dns_managed_zone.hexapax.name
  rrdatas      = [google_compute_global_address.devbox_lb.address]
}
