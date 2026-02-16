# Scout Coach Tier 2 — System Architecture

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    GCP Project: scout-coach                  │
│                    (hexapax.com workspace)                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         GCE VM (e2-medium, Ubuntu 24.04)              │   │
│  │         Static External IP + DNS                      │   │
│  │                                                       │   │
│  │  ┌─────────────────────────────────────────────────┐  │   │
│  │  │            Docker Compose Stack                  │  │   │
│  │  │                                                  │  │   │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │  │   │
│  │  │  │ Caddy    │  │LibreChat │  │ Scout Quest  │  │  │   │
│  │  │  │ (reverse │──│ API      │──│ MCP Server   │  │  │   │
│  │  │  │  proxy)  │  │ :3080    │  │ (stdio)      │  │  │   │
│  │  │  │ :443/80  │  │          │  │              │  │  │   │
│  │  │  └──────────┘  └────┬─────┘  └──────┬───────┘  │  │   │
│  │  │                     │               │           │  │   │
│  │  │  ┌──────────┐  ┌───┴──────┐  ┌─────┴────────┐  │  │   │
│  │  │  │ Redis    │  │ MongoDB  │  │ Quest State  │  │  │   │
│  │  │  │ :6379    │  │ :27017   │  │ (in Mongo)   │  │  │   │
│  │  │  └──────────┘  └──────────┘  └──────────────┘  │  │   │
│  │  └─────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────┐                                           │
│  │ GCS Bucket   │  Terraform state, backups                 │
│  └──────────────┘                                           │
└─────────────────────────────────────────────────────────────┘

External APIs:
  ├── Anthropic API (Claude Sonnet/Opus)
  ├── OpenAI API (Whisper STT, TTS, optional GPT fallback)
  ├── Google API (Gemini, optional)
  └── Gmail SMTP (notifications + password reset)
```

## Why This Architecture

**Single VM with Docker Compose** over Cloud Run because:
- LibreChat needs MongoDB + Redis as sidecars — Cloud Run would need Atlas + Memorystore (extra cost/complexity)
- MCP servers run as stdio subprocesses — doesn't map to Cloud Run's request model
- Docker Compose is LibreChat's primary supported deployment path
- An e2-medium ($25-35/mo) handles 5-10 concurrent users easily
- Proven path with community support and documentation

**Caddy over Nginx** because:
- Automatic HTTPS with Let's Encrypt (zero config)
- Single binary, no Lua/module complexity
- Perfect for a personal project — just set the domain and go

---

## Current Deployment State

LibreChat is **deployed and running** at `https://scout-quest.hexapax.com` on GCE e2-medium (Ubuntu 24.04):
- Docker Compose stack: api, mongodb, meilisearch, rag_api, vectordb containers all running
- Caddy reverse proxy handles HTTPS
- Google OAuth working, Jeremy (admin) signed in
- AI providers configured: Anthropic (working), OpenAI (quota issue), DeepSeek, OpenRouter
- MongoDB service name in docker-compose is `mongodb` (NOT `mongo` — this caused bugs during deployment)
- App root on VM: `/opt/scoutcoach/librechat`
- MCP servers mount: `./mcp-servers` → `/app/mcp-servers` inside api container

---

## Feature Mapping

| Requirement | Implementation |
|---|---|
| Multi-user accounts | LibreChat built-in auth (email/password or Google OAuth) |
| Image upload (troubleshooting) | LibreChat multimodal — works with Claude, GPT-4o, Gemini |
| Voice/live chat in-context | LibreChat STT (Whisper) + TTS (OpenAI voices) — stays in same conversation |
| Long-term memory (20+ weeks) | LibreChat native memory system + custom Quest State MCP |
| Multiple model support | LibreChat endpoints: Anthropic, OpenAI, Google all configurable |
| Email composition | Custom MCP tool: compose in chat → opens mailto: or sends via SMTP |
| Chore reminders | Custom MCP tool: scheduled checks + email/push notifications |
| Per-scout state tracking | Custom MCP with per-user MongoDB collections |

---

## LibreChat Configuration

### `librechat.yaml` — Key Sections

```yaml
version: 1.2.8
cache: true

# --- Memory (persistent across conversations) ---
memory:
  disabled: false
  validKeys:
    - "quest_progress"
    - "personal_preferences"
    - "learned_facts"
    - "conversation_context"
  tokenLimit: 4000
  charLimit: 15000
  personalize: true
  messageWindowSize: 10
  agent:
    provider: "anthropic"
    model: "claude-sonnet-4-5-20250514"
    instructions: |
      You are a memory agent for a Boy Scout coaching system.
      Store ONLY explicitly stated information in these categories:
      - quest_progress: merit badge requirements completed, hardware purchased,
        budget amounts, chore streaks, week number
      - personal_preferences: how the scout likes to communicate, interests,
        what motivates them
      - learned_facts: scout's name, troop, counselor names/emails, parent info
      - conversation_context: current phase of quest, what was discussed last session
      Focus on facts. Be concise. Delete outdated info promptly.
    model_parameters:
      temperature: 0.2
      max_tokens: 2000

# --- Speech (voice mode that stays in-context) ---
speech:
  stt:
    openai:
      apiKey: "${STT_API_KEY}"
      model: "whisper-1"
  tts:
    openai:
      apiKey: "${TTS_API_KEY}"
      model: "tts-1"
      voices: ["nova", "alloy", "echo", "fable", "onyx", "shimmer"]

# --- MCP Servers ---
mcpServers:
  scout-quest:
    type: stdio
    command: node
    args:
      - "/app/mcp-servers/scout-quest/dist/index.js"
    env:
      MONGO_URI: "mongodb://mongodb:27017/scoutquest"
      SMTP_HOST: "smtp.gmail.com"
      SMTP_PORT: "587"
      SMTP_USER: "${EMAIL_USERNAME}"
      SMTP_PASS: "${EMAIL_PASSWORD}"
      SMTP_FROM: "${EMAIL_FROM}"
    timeout: 30000
    serverInstructions: true

# --- Endpoints ---
endpoints:
  anthropic:
    enabled: true
  openAI:
    enabled: true
  google:
    enabled: true
```

### `.env` — Key Variables

```bash
# Auth
ALLOW_REGISTRATION=true          # Set false after scouts registered
ALLOW_SOCIAL_LOGIN=false         # Or true for Google OAuth
DOMAIN_SERVER=https://scout-quest.hexapax.com
DOMAIN_CLIENT=https://scout-quest.hexapax.com

# API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
# GOOGLE_KEY=...                 # Optional: Gemini

# Speech
STT_API_KEY=${OPENAI_API_KEY}
TTS_API_KEY=${OPENAI_API_KEY}

# Email (for password reset + notifications)
EMAIL_SERVICE=gmail
EMAIL_USERNAME=scoutcoach@hexapax.com
EMAIL_PASSWORD=xxxx-xxxx-xxxx-xxxx     # Gmail app password
EMAIL_FROM=scoutcoach@hexapax.com
EMAIL_FROM_NAME=Scout Coach
ALLOW_PASSWORD_RESET=true

# Security (generate unique values!)
CREDS_IV=<generate>
CREDS_KEY=<generate>
JWT_SECRET=<generate>
JWT_REFRESH_SECRET=<generate>

# Mongo
MONGO_URI=mongodb://mongodb:27017/LibreChat
```

### `docker-compose.override.yml`

```yaml
services:
  api:
    volumes:
      - type: bind
        source: ./librechat.yaml
        target: /app/librechat.yaml
      - type: bind
        source: ./mcp-servers
        target: /app/mcp-servers
    environment:
      - NODE_ENV=production
    depends_on:
      - mongodb
      - redis

  mongodb:
    volumes:
      - mongo_data:/data/db

  redis:
    volumes:
      - redis_data:/data

volumes:
  mongo_data:
  redis_data:
```

### Caddyfile

```
scout-quest.hexapax.com {
    reverse_proxy localhost:3080
}
```

---

## LibreChat Agent Configuration

Create a "Scout Coach" agent in LibreChat's Agent Builder:

```
Name: Scout Coach
Model: claude-sonnet-4-5-20250514
System Prompt: [The full system prompt from Tier 1, adapted for MCP tool use]

MCP Servers: scout-quest (all tools enabled)

Instructions additions for MCP:
- When scout asks "where am I?" → call get_quest_summary
- When scout completes a task → call update_quest_state
- When scout needs to email counselor → call compose_email with proper To/CC
- At start of each session → call check_reminders, then get_quest_state
- When discussing purchases → call search_hardware for current prices
- When scout reports chore done → call log_chore and celebrate streak
```

---

## Terraform Infrastructure

### File Structure

```
terraform/
├── main.tf              # Provider, project, backend
├── network.tf           # VPC, firewall rules (80, 443, 22)
├── compute.tf           # VM instance + static IP
├── storage.tf           # GCS bucket for state + backups
├── cloud-init.yaml      # VM startup: install Docker, clone config
├── variables.tf         # Project ID, region, machine type, domain
├── outputs.tf           # External IP, SSH command
└── terraform.tfvars     # Your values (gitignored)
```

### `main.tf`

```hcl
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
  backend "gcs" {
    bucket = "scout-coach-tfstate"
    prefix = "terraform/state"
  }
}

provider "google" {
  project     = var.project_id
  region      = var.region
  credentials = file(var.credentials_file)
}
```

### `compute.tf`

```hcl
resource "google_compute_address" "static" {
  name = "scout-coach-ip"
}

resource "google_compute_instance" "scout_coach" {
  name         = "scout-coach-vm"
  machine_type = "e2-medium"
  zone         = "${var.region}-b"

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = 30
    }
  }

  network_interface {
    network    = google_compute_network.vpc.id
    subnetwork = google_compute_subnetwork.subnet.id
    access_config {
      nat_ip = google_compute_address.static.address
    }
  }

  metadata = {
    user-data = file("cloud-init.yaml")
  }

  tags = ["scout-coach", "http-server", "https-server"]

  service_account {
    email  = var.vm_service_account_email
    scopes = ["cloud-platform"]
  }
}
```

### `network.tf`

```hcl
resource "google_compute_network" "vpc" {
  name                    = "scout-coach-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet" {
  name          = "scout-coach-subnet"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

resource "google_compute_firewall" "allow_http" {
  name    = "scout-coach-allow-http"
  network = google_compute_network.vpc.id
  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["http-server", "https-server"]
}

resource "google_compute_firewall" "allow_ssh" {
  name    = "scout-coach-allow-ssh"
  network = google_compute_network.vpc.id
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
  source_ranges = ["0.0.0.0/0"]  # Tighten to your IP in production
  target_tags   = ["scout-coach"]
}
```

### `cloud-init.yaml`

```yaml
#cloud-config
package_update: true
package_upgrade: true

packages:
  - docker.io
  - docker-compose-v2
  - git
  - curl
  - jq

runcmd:
  - systemctl enable docker
  - systemctl start docker
  - useradd -r -m -G docker scoutcoach
  - mkdir -p /opt/scoutcoach
  - chown scoutcoach:scoutcoach /opt/scoutcoach
  - sudo -u scoutcoach git clone https://github.com/danny-avila/LibreChat.git /opt/scoutcoach/librechat
  - cd /opt/scoutcoach/librechat
  - curl -sS https://caddyserver.com/api/download?os=linux&arch=amd64 -o /usr/local/bin/caddy
  - chmod +x /usr/local/bin/caddy
  - touch /opt/scoutcoach/.cloud-init-complete
```

---

## Post-Terraform Deploy Script

```bash
#!/bin/bash
# deploy-config.sh — run from your machine after terraform apply
# Usage: ./deploy-config.sh <VM_IP>

VM_IP=$1
SSH_KEY=~/.ssh/google_compute_engine

echo "=== Deploying Scout Coach config to $VM_IP ==="

# Wait for cloud-init
echo "Waiting for cloud-init to complete..."
until ssh -i $SSH_KEY -o StrictHostKeyChecking=no ubuntu@$VM_IP \
  "test -f /opt/scoutcoach/.cloud-init-complete"; do
  sleep 10
  echo "  ...still waiting"
done
echo "Cloud-init complete!"

# Upload config files
scp -i $SSH_KEY -r ./config/* ubuntu@$VM_IP:/tmp/scout-config/

# Run remote setup
ssh -i $SSH_KEY ubuntu@$VM_IP 'bash -s' << 'REMOTE_SCRIPT'
  set -e
  cd /opt/scoutcoach/librechat

  sudo -u scoutcoach cp /tmp/scout-config/.env .
  sudo -u scoutcoach cp /tmp/scout-config/librechat.yaml .
  sudo -u scoutcoach cp /tmp/scout-config/docker-compose.override.yml .

  sudo -u scoutcoach mkdir -p ./mcp-servers/scout-quest
  sudo -u scoutcoach cp -r /tmp/scout-config/mcp-server/* ./mcp-servers/scout-quest/

  sudo cp /tmp/scout-config/Caddyfile /etc/caddy/Caddyfile

  # Generate security keys if not already in .env
  if grep -q '<generate>' .env; then
    CREDS_IV=$(openssl rand -hex 16)
    CREDS_KEY=$(openssl rand -hex 32)
    JWT_SECRET=$(openssl rand -hex 32)
    JWT_REFRESH=$(openssl rand -hex 32)
    sed -i "s|CREDS_IV=<generate>|CREDS_IV=$CREDS_IV|" .env
    sed -i "s|CREDS_KEY=<generate>|CREDS_KEY=$CREDS_KEY|" .env
    sed -i "s|JWT_SECRET=<generate>|JWT_SECRET=$JWT_SECRET|" .env
    sed -i "s|JWT_REFRESH_SECRET=<generate>|JWT_REFRESH_SECRET=$JWT_REFRESH|" .env
  fi

  sudo -u scoutcoach docker compose up -d
  sudo systemctl enable caddy
  sudo systemctl start caddy

  echo "=== Scout Coach is live! ==="
REMOTE_SCRIPT

echo ""
echo "Done! Access at: https://scout-quest.hexapax.com"
echo "First user to register becomes admin."
```

---

## Cost Estimate (Monthly)

| Item | Cost |
|---|---|
| GCE e2-medium VM | ~$25-35 |
| 30GB persistent disk | ~$1.50 |
| Static IP | ~$3 (free while attached to running VM) |
| Anthropic API (~2-3 convos/day) | ~$5-15 |
| OpenAI API (Whisper STT + TTS) | ~$2-5 |
| Gmail SMTP | Free (with existing Google Workspace) |
| **Total** | **~$35-60/month** |

To reduce costs if idle: schedule VM to stop overnight via GCP Instance Schedule.

---

## Deployment Sequence

### Phase 1: Infrastructure (~15 min)
1. Create GCP project "scout-coach" in hexapax.com console
2. Enable Compute Engine API
3. Create service account + download key
4. Clone the deploy repo to your machine
5. Fill in `terraform.tfvars` (project ID, domain, API keys)
6. `terraform init && terraform apply`
7. Note the static IP from output
8. Update DNS: `scout-quest.hexapax.com` → `<static IP>`

### Phase 2: Application Config (~10 min)
9. Edit `config/.env` with your API keys
10. Run `./deploy-config.sh <VM_IP>`
11. Wait ~3 minutes for containers to pull and start
12. Visit `https://scout-quest.hexapax.com`
13. Register your admin account (first user)
14. Register Will's account
15. Set `ALLOW_REGISTRATION=false` in `.env`, restart

### Phase 3: Agent Setup (~10 min in UI)
16. In LibreChat UI → Agents → Create New Agent
17. Name: "Scout Coach", Model: Claude Sonnet
18. Paste system prompt (adapted from Tier 1)
19. Add scout-quest MCP server + enable all tools
20. Test with "Hi, I'm Will!" — should load quest state

### Phase 4: MCP Development (separate session)
21. Develop and test scout-quest MCP server locally
22. Deploy to VM via scp + docker compose restart api
23. Iterate as needed

---

## Known Gotchas

- MongoDB service name is `mongodb` not `mongo` in docker-compose
- The API container runs as user scoutcoach (UID/GID set in .env)
- MeiliSearch has non-critical fetch errors — ignore
- OpenAI has quota issue — may affect any OpenAI-dependent features
- SMTP credentials for Gmail need app password, not regular password
- Caddy handles HTTPS automatically — no cert management needed
- The override file uses empty user string for mongodb to let it run as default internal user
