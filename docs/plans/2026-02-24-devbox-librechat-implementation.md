# Devbox LibreChat + Claude Code — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy a LibreChat instance on the devbox VM with Claude Code and browser automation MCP servers, accessible via IAP-protected HTTPS at `devbox.hexapax.com`.

**Architecture:** Global HTTPS LB with IAP → devbox VM running native LibreChat (Node.js) with Docker MongoDB/Redis. Two MCP servers: `claude-code-mcp` (wraps Claude CLI) and `@playwright/mcp` (headless Chromium). Cross-project IAM for infra management.

**Tech Stack:** Terraform (GCP), Node.js 24 (nvm), Docker, LibreChat, `@steipete/claude-code-mcp`, `@playwright/mcp`

**Design doc:** `docs/plans/2026-02-24-devbox-librechat-design.md`

---

## Task 1: Terraform — Variables and Provider Updates

**Files:**
- Modify: `devbox/terraform/variables.tf`
- Modify: `devbox/terraform/main.tf`

**Step 1: Add new variables to `devbox/terraform/variables.tf`**

Append these variables for DNS, IAP, and cross-project access:

```hcl
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
```

**Step 2: Add google-beta provider to `devbox/terraform/main.tf`**

IAP resources require the `google-beta` provider. Add it alongside the existing `google` provider:

```hcl
terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = "hexapax-devbox-tfstate"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
```

**Step 3: Verify syntax**

Run: `terraform -chdir=devbox/terraform validate`
Expected: `Success! The configuration is valid.`

**Step 4: Commit**

```bash
git add devbox/terraform/variables.tf devbox/terraform/main.tf
git commit -m "feat(devbox): add variables for IAP, DNS, and cross-project IAM"
```

---

## Task 2: Terraform — HTTPS Load Balancer

**Files:**
- Create: `devbox/terraform/lb.tf`

**Step 1: Create the load balancer configuration**

Create `devbox/terraform/lb.tf` with all LB resources:

```hcl
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
```

**Step 2: Verify syntax**

Run: `terraform -chdir=devbox/terraform validate`
Expected: `Success! The configuration is valid.`

**Step 3: Commit**

```bash
git add devbox/terraform/lb.tf
git commit -m "feat(devbox): add HTTPS load balancer for IAP web access"
```

---

## Task 3: Terraform — IAP, Firewall, DNS, Cross-Project IAM

**Files:**
- Create: `devbox/terraform/iap.tf`
- Create: `devbox/terraform/dns.tf`
- Modify: `devbox/terraform/network.tf`
- Modify: `devbox/terraform/outputs.tf`

**Step 1: Create IAP configuration in `devbox/terraform/iap.tf`**

```hcl
# ============================================
# Identity-Aware Proxy — access control
# ============================================

# --- IAP access for admin user ---
resource "google_iap_web_backend_service_iam_member" "devbox_admin" {
  provider            = google-beta
  web_backend_service = google_compute_backend_service.devbox.name
  role                = "roles/iap.httpsResourceAccessor"
  member              = "user:${var.iap_admin_email}"
}

# ============================================
# Cross-Project IAM — devbox SA in other projects
# ============================================

# Get the default compute SA email
data "google_compute_default_service_account" "devbox" {
}

# --- Editor in scout-assistant project ---
resource "google_project_iam_member" "devbox_sa_scout_editor" {
  project = var.scout_project_id
  role    = "roles/editor"
  member  = "serviceAccount:${data.google_compute_default_service_account.devbox.email}"
}

# --- DNS admin in hexapax-web project ---
resource "google_project_iam_member" "devbox_sa_dns_admin" {
  project = var.dns_project_id
  role    = "roles/dns.admin"
  member  = "serviceAccount:${data.google_compute_default_service_account.devbox.email}"
}

# --- Storage admin in scout-assistant for GCS state/secrets ---
resource "google_project_iam_member" "devbox_sa_scout_storage" {
  project = var.scout_project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${data.google_compute_default_service_account.devbox.email}"
}
```

**Step 2: Create DNS record in `devbox/terraform/dns.tf`**

```hcl
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
```

**Step 3: Add firewall rule for health checks to `devbox/terraform/network.tf`**

Append to the existing file:

```hcl
# --- Firewall: Allow GCP health checks + LB to reach LibreChat ---
# Google LB and health check source ranges
resource "google_compute_firewall" "allow_lb_health_check" {
  name    = "devbox-allow-lb-health-check"
  network = google_compute_network.vpc.id

  allow {
    protocol = "tcp"
    ports    = ["3080"]
  }

  source_ranges = [
    "130.211.0.0/22",   # GCP health checks
    "35.191.0.0/16",    # GCP health checks
    "35.235.240.0/20",  # IAP
  ]
  target_tags = ["devbox"]
}
```

**Step 4: Update outputs in `devbox/terraform/outputs.tf`**

Replace the entire file:

```hcl
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

output "lb_ip" {
  description = "Load balancer external IP"
  value       = google_compute_global_address.devbox_lb.address
}

output "devbox_url" {
  description = "IAP-protected URL for LibreChat"
  value       = "https://${var.domain_devbox}"
}

output "devbox_sa_email" {
  description = "VM service account email (for cross-project IAM)"
  value       = data.google_compute_default_service_account.devbox.email
}
```

**Step 5: Verify syntax**

Run: `terraform -chdir=devbox/terraform validate`
Expected: `Success! The configuration is valid.`

**Step 6: Commit**

```bash
git add devbox/terraform/iap.tf devbox/terraform/dns.tf devbox/terraform/network.tf devbox/terraform/outputs.tf
git commit -m "feat(devbox): add IAP auth, DNS record, firewall, cross-project IAM"
```

---

## Task 4: Terraform — Plan and Apply

**Files:** None (execution only)

**Step 1: Initialize Terraform (pick up new google-beta provider)**

Run: `terraform -chdir=devbox/terraform init -upgrade`
Expected: `Terraform has been successfully initialized!`

**Step 2: Plan**

Run: `terraform -chdir=devbox/terraform plan`
Expected: Plan shows ~12-15 new resources. Review carefully:
- `google_compute_global_address.devbox_lb`
- `google_compute_managed_ssl_certificate.devbox`
- `google_compute_instance_group.devbox`
- `google_compute_health_check.devbox_http`
- `google_compute_backend_service.devbox`
- `google_compute_url_map.devbox`
- `google_compute_target_https_proxy.devbox`
- `google_compute_global_forwarding_rule.devbox`
- `google_iap_web_backend_service_iam_member.devbox_admin`
- `google_dns_record_set.devbox`
- `google_compute_firewall.allow_lb_health_check`
- `google_project_iam_member.devbox_sa_*` (3 bindings)

No existing resources should be changed or destroyed.

**Step 3: Apply**

Run: `terraform -chdir=devbox/terraform apply`
Expected: All resources created. Note the outputs:
- `lb_ip` — the static IP
- `devbox_url` — `https://devbox.hexapax.com`
- `devbox_sa_email` — SA email for reference

**Important:** The managed SSL certificate takes 10-60 minutes to provision after DNS propagation. The LB will return 502 until LibreChat is running on the VM. Both are expected.

**Step 4: Verify DNS propagation**

Run: `dig devbox.hexapax.com +short`
Expected: Shows the LB IP address from the output

---

## Task 5: VM Setup Script — MongoDB, Redis, LibreChat

**Files:**
- Create: `devbox/scripts/setup-librechat.sh`

**Step 1: Write the setup script**

```bash
#!/usr/bin/env bash
# setup-librechat.sh — Install LibreChat + dependencies on devbox VM
# Run as devuser: sudo -u devuser bash setup-librechat.sh
# Idempotent: safe to re-run
set -euo pipefail

LIBRECHAT_DIR="$HOME/LibreChat"
SCOUT_QUEST_DIR="$HOME/scout-quest"
NVM_DIR="$HOME/.nvm"

echo "=== Loading nvm ==="
export NVM_DIR
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

echo "=== Node version: $(node -v) ==="

# --- Docker containers (MongoDB + Redis) ---
echo "=== Starting MongoDB ==="
if ! docker ps --format '{{.Names}}' | grep -q '^librechat-mongo$'; then
  docker rm -f librechat-mongo 2>/dev/null || true
  docker run -d --name librechat-mongo --restart unless-stopped \
    -p 127.0.0.1:27017:27017 \
    -v librechat-mongo-data:/data/db \
    mongo:7
  echo "MongoDB started"
else
  echo "MongoDB already running"
fi

echo "=== Starting Redis ==="
if ! docker ps --format '{{.Names}}' | grep -q '^librechat-redis$'; then
  docker rm -f librechat-redis 2>/dev/null || true
  docker run -d --name librechat-redis --restart unless-stopped \
    -p 127.0.0.1:6379:6379 \
    redis:7-alpine
  echo "Redis started"
else
  echo "Redis already running"
fi

# --- Clone LibreChat ---
echo "=== Setting up LibreChat ==="
if [ ! -d "$LIBRECHAT_DIR" ]; then
  git clone https://github.com/danny-avila/LibreChat.git "$LIBRECHAT_DIR"
  echo "LibreChat cloned"
else
  echo "LibreChat directory exists, pulling latest"
  git -C "$LIBRECHAT_DIR" pull --ff-only || echo "Pull failed (not on a branch?), skipping"
fi

# --- Install dependencies ---
echo "=== Installing LibreChat dependencies ==="
cd "$LIBRECHAT_DIR"
npm ci

# --- Build frontend ---
echo "=== Building LibreChat frontend ==="
npm run frontend

# --- Clone scout-quest repo ---
echo "=== Setting up scout-quest repo ==="
if [ ! -d "$SCOUT_QUEST_DIR" ]; then
  git clone https://github.com/jebramwell/scout-quest.git "$SCOUT_QUEST_DIR"
  echo "scout-quest cloned"
else
  echo "scout-quest directory exists"
fi

# --- Install Playwright + Chromium ---
echo "=== Installing Playwright browser ==="
npx playwright install --with-deps chromium

# --- Install claude-code-mcp globally ---
echo "=== Installing claude-code-mcp ==="
npm install -g @steipete/claude-code-mcp

# --- Accept claude --dangerously-skip-permissions terms ---
# claude-code-mcp requires this one-time acceptance
echo "=== Checking Claude Code permissions setup ==="
if command -v claude &>/dev/null; then
  echo "Claude Code CLI found at: $(which claude)"
  echo "Remember to run 'claude login' manually to authenticate with your Max plan"
else
  echo "WARNING: Claude Code CLI not found in PATH"
fi

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Copy .env and librechat.yaml to $LIBRECHAT_DIR/"
echo "  2. Run 'claude login' to authenticate Claude Code"
echo "  3. Run 'claude --dangerously-skip-permissions' once to accept terms"
echo "  4. Start LibreChat: cd $LIBRECHAT_DIR && npm run backend"
```

**Step 2: Commit**

```bash
git add devbox/scripts/setup-librechat.sh
git commit -m "feat(devbox): add LibreChat setup script for VM provisioning"
```

---

## Task 6: LibreChat Configuration Files

**Files:**
- Create: `config/devbox/.env.example`
- Create: `config/devbox/librechat.yaml`

**Step 1: Create `.env.example`**

```bash
# ============================================
# Devbox LibreChat — Environment Variables
# ============================================
# Copy to LibreChat/.env on the VM and fill in secrets.
# Secrets NEVER committed to git.

# --- App ---
HOST=0.0.0.0
PORT=3080
DOMAIN_CLIENT=https://devbox.hexapax.com
DOMAIN_SERVER=https://devbox.hexapax.com

# --- Database ---
MONGO_URI=mongodb://localhost:27017/LibreChat

# --- Redis ---
USE_REDIS=true
REDIS_URI=redis://localhost:6379

# --- Auth (local only, no OAuth) ---
ALLOW_EMAIL_LOGIN=true
ALLOW_REGISTRATION=true
ALLOW_SOCIAL_LOGIN=false
SESSION_EXPIRY=1000 * 60 * 60 * 24 * 7

# --- Security (auto-generated on first run if empty) ---
CREDS_KEY=
CREDS_IV=
JWT_SECRET=
JWT_REFRESH_SECRET=

# --- Model API Keys ---
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_KEY=

# --- MCP Server Environment ---
# Used by claude-code-mcp to set the working directory
CLAUDE_WORK_DIR=/home/devuser/scout-quest
```

**Step 2: Create `config/devbox/librechat.yaml`**

```yaml
# ============================================
# Devbox LibreChat — Configuration
# ============================================
# Copy to LibreChat/librechat.yaml on the VM.
# Minimal dev-focused setup with Claude Code + browser MCP.

version: 1.2.1
cache: true

interface:
  endpointsMenu: true

# --- MCP Servers ---
mcpServers:
  claude-code:
    type: stdio
    command: npx
    args:
      - "-y"
      - "@steipete/claude-code-mcp@latest"
    env:
      CLAUDE_WORK_DIR: /home/devuser/scout-quest
    timeout: 300000

  browser:
    type: stdio
    command: npx
    args:
      - "@playwright/mcp@latest"
      - "--headless"
    timeout: 60000

# --- Endpoints ---
endpoints:
  anthropic:
    titleModel: "claude-haiku-4-5-20251001"

  openAI:
    titleModel: "gpt-4.1-mini"

# --- Model Specs ---
modelSpecs:
  enforce: false
  prioritize: true
  list:
    - name: "Claude Sonnet"
      label: "Claude Sonnet 4.6"
      description: "Primary coding assistant with Claude Code and browser tools"
      preset:
        endpoint: "anthropic"
        model: "claude-sonnet-4-6"
        modelLabel: "Claude Sonnet"
        mcpServers:
          - "claude-code"
          - "browser"

    - name: "Claude Haiku"
      label: "Claude Haiku 4.5"
      description: "Fast and cheap with Claude Code and browser tools"
      preset:
        endpoint: "anthropic"
        model: "claude-haiku-4-5-20251001"
        modelLabel: "Claude Haiku"
        mcpServers:
          - "claude-code"
          - "browser"

    - name: "GPT-4.1"
      label: "GPT-4.1"
      description: "OpenAI with 1M context, Claude Code and browser tools"
      preset:
        endpoint: "openAI"
        model: "gpt-4.1"
        modelLabel: "GPT-4.1"
        mcpServers:
          - "claude-code"
          - "browser"

    - name: "Quick Chat"
      label: "Quick Chat"
      description: "Fast chat, no tools"
      preset:
        endpoint: "anthropic"
        model: "claude-haiku-4-5-20251001"
        modelLabel: "Quick Chat"
```

**Step 3: Commit**

```bash
git add config/devbox/.env.example config/devbox/librechat.yaml
git commit -m "feat(devbox): add LibreChat config files (.env.example, librechat.yaml)"
```

---

## Task 7: Systemd Service for LibreChat

**Files:**
- Create: `devbox/config/librechat.service`
- Modify: `devbox/scripts/setup-librechat.sh` (add service install step)

**Step 1: Create systemd service file**

```ini
# /etc/systemd/system/librechat.service
# LibreChat on devbox — runs as devuser with nvm Node.js
[Unit]
Description=LibreChat (devbox)
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=devuser
Group=devuser
WorkingDirectory=/home/devuser/LibreChat
Environment=NVM_DIR=/home/devuser/.nvm
ExecStart=/bin/bash -c 'source $NVM_DIR/nvm.sh && npm run backend'
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Step 2: Commit**

```bash
git add devbox/config/librechat.service
git commit -m "feat(devbox): add systemd service file for LibreChat"
```

---

## Task 8: Deploy Script — Orchestrates VM Setup

**Files:**
- Create: `devbox/scripts/deploy-librechat.sh`

**Step 1: Write the deploy script**

This script runs from your local machine and orchestrates the full deployment to the VM via SSH.

```bash
#!/usr/bin/env bash
# deploy-librechat.sh — Deploy LibreChat to devbox VM
# Usage: bash devbox/scripts/deploy-librechat.sh
set -euo pipefail

PROJECT="hexapax-devbox"
ZONE="us-east4-b"
VM="devbox-vm"
REMOTE_USER="devuser"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

ssh_cmd() {
  gcloud compute ssh "$VM" \
    --zone="$ZONE" \
    --project="$PROJECT" \
    --tunnel-through-iap \
    --command="$1"
}

scp_cmd() {
  gcloud compute scp "$1" "$VM:$2" \
    --zone="$ZONE" \
    --project="$PROJECT" \
    --tunnel-through-iap
}

echo "=== Step 1: Upload scripts and config ==="
scp_cmd "$REPO_ROOT/devbox/scripts/setup-librechat.sh" "/tmp/setup-librechat.sh"
scp_cmd "$REPO_ROOT/devbox/config/librechat.service" "/tmp/librechat.service"
scp_cmd "$REPO_ROOT/config/devbox/librechat.yaml" "/tmp/librechat.yaml"

echo "=== Step 2: Run setup script as devuser ==="
ssh_cmd "chmod +x /tmp/setup-librechat.sh && sudo -u $REMOTE_USER bash /tmp/setup-librechat.sh"

echo "=== Step 3: Copy librechat.yaml ==="
ssh_cmd "sudo -u $REMOTE_USER cp /tmp/librechat.yaml /home/$REMOTE_USER/LibreChat/librechat.yaml"

echo "=== Step 4: Install systemd service ==="
ssh_cmd "sudo cp /tmp/librechat.service /etc/systemd/system/librechat.service && sudo systemctl daemon-reload && sudo systemctl enable librechat"

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Remaining manual steps:"
echo "  1. SSH in: gcloud compute ssh $VM --zone=$ZONE --project=$PROJECT --tunnel-through-iap"
echo "  2. Create .env: sudo -u devuser cp /home/devuser/LibreChat/.env.example /home/devuser/LibreChat/.env"
echo "  3. Fill in API keys in .env"
echo "  4. Auth Claude Code: sudo -u devuser -i claude login"
echo "  5. Accept permissions: sudo -u devuser -i claude --dangerously-skip-permissions (then Ctrl+C after accepting)"
echo "  6. Start: sudo systemctl start librechat"
echo "  7. Verify: curl -s http://localhost:3080/api/health"
echo "  8. Access: https://devbox.hexapax.com (after SSL cert provisions)"
```

**Step 2: Commit**

```bash
git add devbox/scripts/deploy-librechat.sh
git commit -m "feat(devbox): add deploy script for LibreChat VM setup"
```

---

## Task 9: Deploy to VM — Run Setup

**Files:** None (execution only)

**Step 1: Verify VM is reachable**

Run: `gcloud compute ssh devbox-vm --zone=us-east4-b --project=hexapax-devbox --tunnel-through-iap --command="echo OK"`
Expected: `OK`

**Step 2: Run the deploy script**

Run: `bash devbox/scripts/deploy-librechat.sh`
Expected: Setup completes without errors. MongoDB and Redis running. LibreChat installed and built.

**Step 3: SSH in for manual steps**

Run: `gcloud compute ssh devbox-vm --zone=us-east4-b --project=hexapax-devbox --tunnel-through-iap`

Then on the VM:

```bash
# Create .env from example
sudo -u devuser cp /home/devuser/LibreChat/.env.example /home/devuser/LibreChat/.env

# Edit .env — fill in API keys
sudo -u devuser nano /home/devuser/LibreChat/.env
# Fill: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_KEY
# Fill: CREDS_KEY, CREDS_IV, JWT_SECRET, JWT_REFRESH_SECRET (generate with: openssl rand -hex 32)

# Authenticate Claude Code
sudo -u devuser -i bash -c 'source ~/.nvm/nvm.sh && claude login'
# Follow the URL, sign in as jebramwell@gmail.com, paste code back

# Accept --dangerously-skip-permissions terms (one-time)
sudo -u devuser -i bash -c 'source ~/.nvm/nvm.sh && claude --dangerously-skip-permissions'
# Type "yes" to accept, then Ctrl+C to exit

# Start LibreChat
sudo systemctl start librechat

# Verify health
curl -s http://localhost:3080/api/health
```

Expected: Health check returns JSON with `{"status":"OK"}` or similar.

---

## Task 10: Smoke Test — End-to-End

**Files:** None (verification only)

**Step 1: Verify health check from VM**

SSH in and run: `curl -s http://localhost:3080/api/health`
Expected: `200 OK` response

**Step 2: Check LB health check status**

Run: `gcloud compute backend-services get-health devbox-backend-service --global --project=hexapax-devbox`
Expected: Shows the instance as `HEALTHY`. (May take a few minutes after LibreChat starts.)

**Step 3: Check SSL certificate status**

Run: `gcloud compute ssl-certificates describe devbox-ssl-cert --global --project=hexapax-devbox`
Expected: Status is `ACTIVE` (may take 10-60 min). If `PROVISIONING`, wait and re-check.

**Step 4: Test IAP access from browser**

Open: `https://devbox.hexapax.com`
Expected:
1. Google sign-in prompt appears
2. Sign in as `jeremy@hexapax.com`
3. LibreChat login/registration page loads
4. Register a local account
5. Chat interface loads with model presets visible

**Step 5: Test MCP tools**

In LibreChat, select "Claude Sonnet" preset and send:
- `"Use the claude_code tool to read the file ~/scout-quest/CLAUDE.md and summarize it"`
Expected: Model calls `claude_code` MCP tool, returns file content summary.

- `"Use the browser tool to navigate to https://example.com and tell me what's on the page"`
Expected: Model calls `browser_navigate` then `browser_snapshot`, describes the page.

**Step 6: Test cross-project access**

SSH into VM and test:
```bash
# Test DNS access to hexapax-web
gcloud dns record-sets list --zone=hexapax-com --project=hexapax-web

# Test compute access to scout-assistant
gcloud compute instances list --project=scout-assistant-487523
```

Expected: Both commands succeed (using the VM's SA credentials).

---

## Task 11: Cleanup and Documentation

**Files:**
- Modify: `docs/development-state.md` (add devbox section)
- Modify: `CLAUDE.md` (add devbox deploy commands)

**Step 1: Update development-state.md**

Add a "Devbox / Remote Development" section:

```markdown
### Devbox / Remote Development (Working)
- [x] GCP VM (e2-standard-4, us-east4-b) in hexapax-devbox project
- [x] IAP-protected web access at devbox.hexapax.com
- [x] LibreChat running natively with MongoDB + Redis (Docker)
- [x] claude-code-mcp providing Claude Code as an MCP tool
- [x] @playwright/mcp providing headless browser automation
- [x] Cross-project IAM: can manage scout-assistant and hexapax-web infra
- [ ] Claude Code OAuth token may need periodic re-auth
```

**Step 2: Add devbox deploy commands to CLAUDE.md**

Add to the "Common Commands" section:

```markdown
### Devbox (remote development)

```bash
# Terraform (devbox infra)
terraform -chdir=devbox/terraform plan
terraform -chdir=devbox/terraform apply

# Deploy LibreChat to devbox VM
bash devbox/scripts/deploy-librechat.sh

# SSH into devbox
gcloud compute ssh devbox-vm --zone=us-east4-b --project=hexapax-devbox --tunnel-through-iap

# Check LibreChat status on VM
gcloud compute ssh devbox-vm --zone=us-east4-b --project=hexapax-devbox --tunnel-through-iap --command="sudo systemctl status librechat"
```
```

**Step 3: Commit all documentation updates**

```bash
git add docs/development-state.md CLAUDE.md
git commit -m "docs: add devbox LibreChat deployment info to state and CLAUDE.md"
```

---

## Execution Notes

### Potential Blockers

1. **IAP OAuth consent screen** — The `hexapax-devbox` project needs an OAuth consent screen configured. If it doesn't exist, Terraform will fail on the backend service IAP config. Fix: `gcloud alpha iap oauth-brands create --application_title="Devbox" --support_email=jeremy@hexapax.com --project=hexapax-devbox` (may need to be done manually in Console).

2. **SSL cert provisioning delay** — Managed SSL certs take 10-60 minutes. The LB will return 502 during this period. This is normal.

3. **LibreChat `.env` secrets** — The script creates `.env.example` but secrets must be filled in manually. Generate crypto values with `openssl rand -hex 32`.

4. **Claude Code OAuth on headless VM** — `claude login` gives a URL to visit on another device. This works over SSH — copy the URL, open in your laptop/phone browser, sign in, paste code back.

5. **nvm PATH in systemd** — The systemd service sources nvm before running npm. If this doesn't work, may need to hard-code the node path (e.g., `/home/devuser/.nvm/versions/node/v24.x.x/bin/npm`).

6. **Default compute SA** — The VM uses the default compute service account. If the project doesn't have one, you'll need to create it or use a custom SA. Check: `gcloud iam service-accounts list --project=hexapax-devbox`.

### Dependency Order

```
Task 1 (variables) → Task 2 (LB) → Task 3 (IAP/DNS/IAM) → Task 4 (terraform apply)
Task 5 (setup script) + Task 6 (config) + Task 7 (systemd) → Task 8 (deploy script) → Task 9 (deploy)
Task 4 + Task 9 → Task 10 (smoke test)
Task 10 → Task 11 (docs)
```

Tasks 1-4 (Terraform) and Tasks 5-8 (scripts/config) can be developed in parallel. Task 9 requires both complete. Task 4 should be applied early since SSL cert provisioning is the longest wait.
