# ============================================================
# Cloud Armor WAF — geo-fence (US only) + OWASP rules
#
# Rule evaluation order: lowest priority number wins first.
#
#   1000–1099  OWASP deny rules      (evaluated first for all traffic)
#   2000       Geo allow (US only)   (pass if request survived OWASP checks)
#   2147483647 Default deny          (everything else — non-US clean traffic)
#
# This means:
#   US   + clean  → passes OWASP (no match) → allowed by geo rule 2000 ✓
#   US   + SQLi   → blocked by rule 1000 ✗
#   non-US + any  → not blocked by OWASP (if clean), then blocked by default ✗
# ============================================================

resource "google_compute_security_policy" "waf" {
  name        = "scout-coach-waf"
  description = "OWASP WAF + US geo-fence for all hexapax.com services"

  # ------------------------------------------------------------------
  # OWASP rules — evaluated first regardless of origin
  # Sensitivity 1 = lowest false positive rate; raise after baseline.
  # Relevant to stack: Flask/Python, markdown rendering (XSS risk),
  # file-system reads (LFI risk), ChromaDB SQLite backend.
  # ------------------------------------------------------------------

  # SQL injection — ChromaDB uses SQLite; good baseline protection
  rule {
    action      = "deny(403)"
    priority    = 1000
    description = "OWASP SQLi (sensitivity 1)"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sqli-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  # XSS — high priority: markdown is rendered to HTML in the viewer
  rule {
    action      = "deny(403)"
    priority    = 1001
    description = "OWASP XSS (sensitivity 1)"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('xss-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  # Local File Inclusion — app reads domain/view files from disk by path
  rule {
    action      = "deny(403)"
    priority    = 1002
    description = "OWASP LFI (sensitivity 1)"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('lfi-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  # Remote Code Execution — general protection
  rule {
    action      = "deny(403)"
    priority    = 1003
    description = "OWASP RCE (sensitivity 1)"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('rce-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  # Scanner detection — blocks automated vulnerability scanners
  rule {
    action      = "deny(403)"
    priority    = 1004
    description = "OWASP scanner detection (sensitivity 1)"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('scannerdetection-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  # Protocol attacks — HTTP smuggling, CRLF injection
  rule {
    action      = "deny(403)"
    priority    = 1005
    description = "OWASP protocol attacks (sensitivity 1)"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('protocolattack-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  # Session fixation — Flask uses signed cookies; still worth blocking
  rule {
    action      = "deny(403)"
    priority    = 1006
    description = "OWASP session fixation (sensitivity 1)"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('sessionfixation-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  # ------------------------------------------------------------------
  # Geo-fence: allow US traffic that survived OWASP checks
  # ------------------------------------------------------------------
  rule {
    action      = "allow"
    priority    = 2000
    description = "Allow US origin traffic"
    match {
      expr {
        expression = "origin.region_code == 'US'"
      }
    }
  }

  # ------------------------------------------------------------------
  # Default: deny everything else (non-US clean traffic)
  # ------------------------------------------------------------------
  rule {
    action      = "deny(403)"
    priority    = 2147483647
    description = "Default deny — non-US or unmatched"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }
}
