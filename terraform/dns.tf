# ============================================
# Cloud DNS — records in existing hexapax-web zone
# ============================================
# The hexapax-com zone lives in the hexapax-web project (alongside
# Cloud CDN + hexapax-backend-bucket). We reference it via data source
# and manage all records here so nothing gets lost.
#
# FIRST TIME SETUP:
#   1. Grant scout-deployer dns.admin on hexapax-web:
#      gcloud projects add-iam-policy-binding hexapax-web \
#        --member="serviceAccount:scout-deployer@scout-assistant-487523.iam.gserviceaccount.com" \
#        --role="roles/dns.admin" --condition=None --quiet
#
#   2. Import existing records into Terraform state:
#      cd terraform
#      terraform import google_dns_record_set.root        hexapax-web/hexapax-com/hexapax.com./A
#      terraform import google_dns_record_set.mx          hexapax-web/hexapax-com/hexapax.com./MX
#      terraform import google_dns_record_set.spf         hexapax-web/hexapax-com/hexapax.com./TXT
#      terraform import google_dns_record_set.dkim        hexapax-web/hexapax-com/google._domainkey.hexapax.com./TXT
#      terraform import google_dns_record_set.scout_quest hexapax-web/hexapax-com/scout-quest.hexapax.com./A

data "google_dns_managed_zone" "hexapax" {
  name    = var.dns_zone_name
  project = var.dns_project_id
}

# --- hexapax.com root A record (Cloud CDN / hexapax-backend-bucket) ---
resource "google_dns_record_set" "root" {
  project      = var.dns_project_id
  name         = "hexapax.com."
  type         = "A"
  ttl          = 300
  managed_zone = data.google_dns_managed_zone.hexapax.name
  rrdatas      = ["35.190.17.141"]
}

# --- MX records (Google Workspace) ---
resource "google_dns_record_set" "mx" {
  project      = var.dns_project_id
  name         = "hexapax.com."
  type         = "MX"
  ttl          = 300
  managed_zone = data.google_dns_managed_zone.hexapax.name
  rrdatas = [
    "1 aspmx.l.google.com.",
    "5 alt1.aspmx.l.google.com.",
    "5 alt2.aspmx.l.google.com.",
    "10 alt3.aspmx.l.google.com.",
    "10 alt4.aspmx.l.google.com.",
  ]
}

# --- SPF record ---
resource "google_dns_record_set" "spf" {
  project      = var.dns_project_id
  name         = "hexapax.com."
  type         = "TXT"
  ttl          = 300
  managed_zone = data.google_dns_managed_zone.hexapax.name
  rrdatas      = ["\"v=spf1 include:_spf.google.com ~all\""]
}

# --- DKIM record (Google Workspace) ---
resource "google_dns_record_set" "dkim" {
  project      = var.dns_project_id
  name         = "google._domainkey.hexapax.com."
  type         = "TXT"
  ttl          = 300
  managed_zone = data.google_dns_managed_zone.hexapax.name
  rrdatas      = ["\"v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCZjeL62KSp8bJcaVep36ToiXYM32YnbxjO1kRh7oJAeXtcGV0mOF/tI3806JBODly7JOOAqXFd3tpY1Bq/mh5bPN/3e0XEunY3r1rxIEnshtQA7DGYcXvBDgtWiaCgGhSl6QeJkkKUXxnOmkO+olAed/D0RUw4Df1qyng2jeNrxQIDAQAB\""]
}

# --- ai-chat + scout-quest A records (scout-coach VM) ---
resource "google_dns_record_set" "ai_chat" {
  project      = var.dns_project_id
  name         = "${var.domain_aichat}."
  type         = "A"
  ttl          = 300
  managed_zone = data.google_dns_managed_zone.hexapax.name
  rrdatas      = [google_compute_address.static.address]
}

resource "google_dns_record_set" "scout_quest" {
  project      = var.dns_project_id
  name         = "${var.domain_scout}."
  type         = "A"
  ttl          = 300
  managed_zone = data.google_dns_managed_zone.hexapax.name
  rrdatas      = [google_compute_address.static.address]
}

resource "google_dns_record_set" "admin" {
  project      = var.dns_project_id
  name         = "${var.domain_admin}."
  type         = "A"
  ttl          = 300
  managed_zone = data.google_dns_managed_zone.hexapax.name
  rrdatas      = [google_compute_address.static.address]
}
