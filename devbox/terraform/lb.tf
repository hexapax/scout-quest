# ============================================
# HTTPS Load Balancer for IAP-protected web access
# ============================================
# Provides devbox.hexapax.com → devbox-vm:3080
# IAP handles authentication (jeremy@hexapax.com)
# VM has no external IP — LB is the only ingress path

# --- Static IP ---
resource "google_compute_global_address" "devbox_lb" {
  name = "devbox-lb-ip"
}

# --- Managed SSL Certificate ---
resource "google_compute_managed_ssl_certificate" "devbox" {
  name = "devbox-ssl-cert"

  managed {
    domains = [var.domain_devbox]
  }
}

# --- Instance Group (unmanaged, wraps the single VM) ---
resource "google_compute_instance_group" "devbox" {
  name      = "devbox-instance-group"
  zone      = var.zone
  instances = [google_compute_instance.devbox.id]

  named_port {
    name = "http"
    port = 3080
  }
}

# --- Health Check ---
resource "google_compute_health_check" "devbox_http" {
  name               = "devbox-http-health-check"
  check_interval_sec = 30
  timeout_sec        = 10

  http_health_check {
    port         = 3080
    request_path = "/api/health"
  }
}

# --- Backend Service (IAP enabled) ---
resource "google_compute_backend_service" "devbox" {
  provider = google-beta
  name     = "devbox-backend-service"

  protocol              = "HTTP"
  port_name             = "http"
  health_checks         = [google_compute_health_check.devbox_http.id]
  timeout_sec           = 300
  connection_draining_timeout_sec = 10

  backend {
    group = google_compute_instance_group.devbox.id
  }

  iap {
    enabled = true
  }
}

# --- URL Map ---
resource "google_compute_url_map" "devbox" {
  name            = "devbox-url-map"
  default_service = google_compute_backend_service.devbox.id
}

# --- HTTPS Proxy ---
resource "google_compute_target_https_proxy" "devbox" {
  name             = "devbox-https-proxy"
  url_map          = google_compute_url_map.devbox.id
  ssl_certificates = [google_compute_managed_ssl_certificate.devbox.id]
}

# --- Forwarding Rule ---
resource "google_compute_global_forwarding_rule" "devbox" {
  name       = "devbox-https-forwarding-rule"
  target     = google_compute_target_https_proxy.devbox.id
  port_range = "443"
  ip_address = google_compute_global_address.devbox_lb.address
}
