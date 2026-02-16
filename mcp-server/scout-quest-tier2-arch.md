# Scout Coach Tier 2 — LibreChat + Custom MCP on GCP

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
│  │  │  │  proxy)  │  │ :3080    │  │ (custom)     │  │  │   │
│  │  │  │ :443/80  │  │          │  │ :3001        │  │  │   │
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

## Component Details

### 1. LibreChat Configuration

**`librechat.yaml`** — key sections:

```yaml
version: 1.2.8
cache: true

# --- Memory (persistent across conversations) ---
memory:
  disabled: false
  validKeys:
    - "quest_progress"        # merit badge status, hardware purchases
    - "personal_preferences"  # communication style, interests
    - "learned_facts"         # scout name, troop, counselors
    - "conversation_context"  # what we discussed recently
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
      - "/app/mcp-servers/scout-quest/index.js"
    env:
      MONGO_URI: "mongodb://mongo:27017/scoutquest"
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

**`.env`** — key variables:

```bash
# Auth
ALLOW_REGISTRATION=true          # Set false after scouts registered
ALLOW_SOCIAL_LOGIN=false         # Or true for Google OAuth
DOMAIN_SERVER=https://scout.hexapax.com
DOMAIN_CLIENT=https://scout.hexapax.com

# API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
# GOOGLE_KEY=...                 # Optional: Gemini

# Speech
STT_API_KEY=${OPENAI_API_KEY}
TTS_API_KEY=${OPENAI_API_KEY}

# Email (for password reset + notifications)
EMAIL_SERVICE=gmail
EMAIL_USERNAME=scoutcoach@hexapax.com  # or your gmail
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
MONGO_URI=mongodb://mongo:27017/LibreChat
```

### 2. Custom MCP Server: Scout Quest

A Node.js MCP server providing tools the AI agent can call. Runs as a sidecar in the Docker Compose stack.

**Tools exposed:**

| Tool | Purpose |
|---|---|
| `get_quest_state` | Retrieve current scout's full quest state (week, phase, purchases, budget, MB progress) |
| `update_quest_state` | Update specific fields (mark requirement complete, add purchase, update budget) |
| `get_quest_summary` | Fun gamified status for the scout ("Phase 2, Week 5! Next loot drop: Motherboard") |
| `compose_email` | Generate mailto: link or send via SMTP. Pre-fills To, CC, Subject, Body |
| `log_chore` | Record chore completion with timestamp and earnings |
| `get_chore_streak` | Calculate current chore streak and total earnings |
| `check_reminders` | Return any pending reminders (overdue chores, upcoming deadlines) |
| `search_hardware` | Web search helper for current prices on PC components |

**Data model** (stored in MongoDB `scoutquest` database):

```javascript
// scouts collection — one doc per registered scout
{
  _id: ObjectId,
  librechat_user_id: "user_abc123",  // links to LibreChat user
  scout_name: "Will",
  troop: "2024",
  quest_week: 5,
  phase: 2,

  merit_badges: {
    personal_management: {
      status: "IN_PROGRESS",
      counselor: { name: "Mr. Chris McDaid", email: "chrismcdaid@att.net" },
      scoutbook_started: true,
      requirements: {
        "req1": { status: "IN_PROGRESS", notes: "Researching SSD options" },
        "req2": { status: "NOT_STARTED", budget_week: 0 },
        // ...
      }
    },
    family_life: {
      status: "IN_PROGRESS",
      counselor: { name: "Mrs. Nicole Allen", email: "texnicking@gmail.com" },
      scoutbook_started: true,
      requirements: {
        "req3": { status: "IN_PROGRESS", chore_day: 34 },
        // ...
      }
    }
  },

  hardware: {
    owned: ["AMD Ryzen 5600X CPU", "Radeon RX 480 GPU"],
    scavenging: ["Possible case — suitability TBD"],
    purchased: [],
    installed: [],
    still_needed: ["CPU Cooler", "RAM", "Motherboard", "SSD", "Case (maybe)", "PSU"],
    bonus_unlocks: ["Gaming keyboard — stretch goal"]
  },

  budget: {
    total_earned: 0,
    total_spent: 0,
    target_estimate: null,
    transactions: []  // { date, amount, description, type: "earned"|"spent" }
  },

  chores: {
    log: [],           // { date, task, earned, completed: true }
    current_streak: 0,
    longest_streak: 0
  },

  emails_sent: [],     // { date, to, cc, subject, context }
  key_decisions: [],   // { date, decision, rationale }

  created_at: ISODate,
  updated_at: ISODate
}

// reminders collection
{
  scout_id: ObjectId,
  type: "chore" | "deadline" | "check_in",
  message: "Time for daily chores!",
  schedule: "daily_6pm" | "weekly_saturday" | "once_2026-03-15",
  last_sent: ISODate,
  active: true
}
```

**Email composition approach:**

The MCP tool generates one of:
1. **`mailto:` link** — rendered in chat as clickable link. Opens default mail client (Gmail on iPad) with To, CC, Subject, Body pre-filled. Best for scout-initiated emails (contacting MBC, etc.)
2. **SMTP send** — for automated notifications/reminders from the system. Uses the same Gmail SMTP as LibreChat's password reset.

For Will's use case, `mailto:` is better for merit badge emails because:
- He sees what's being sent (YPT transparency)
- Parent is CC'd automatically
- He clicks to review and send — feels like HIS email, not the AI's
- Works on iPad Gmail app

### 3. LibreChat Agent Configuration

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

## Deployment Plan

### Prerequisites (Manual, ~10 minutes)

1. **Create GCP Project**
   ```
   Project name: scout-coach
   Organization: hexapax.com
   Billing: linked to your credit card
   ```

2. **Enable APIs** (in Cloud Console or via gcloud):
   ```bash
   gcloud services enable compute.googleapis.com
   gcloud services enable dns.googleapis.com  # if using Cloud DNS
   ```

3. **Create Service Account**
   ```bash
   gcloud iam service-accounts create scout-deployer \
     --display-name="Scout Coach Deployer"

   # Grant minimum required roles
   gcloud projects add-iam-policy-binding scout-coach \
     --member="serviceAccount:scout-deployer@scout-coach.iam.gserviceaccount.com" \
     --role="roles/compute.admin"

   gcloud projects add-iam-policy-binding scout-coach \
     --member="serviceAccount:scout-deployer@scout-coach.iam.gserviceaccount.com" \
     --role="roles/storage.admin"

   # Download key
   gcloud iam service-accounts keys create ~/scout-deployer-key.json \
     --iam-account=scout-deployer@scout-coach.iam.gserviceaccount.com
   ```

4. **DNS**: Point `scout.hexapax.com` → (will fill in static IP after Terraform)

### Terraform Deployment (~5 minutes to run)

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

**`main.tf`**:
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

**`compute.tf`**:
```hcl
resource "google_compute_address" "static" {
  name = "scout-coach-ip"
}

resource "google_compute_instance" "scout_coach" {
  name         = "scout-coach-vm"
  machine_type = "e2-medium"    # 2 vCPU, 4GB RAM — plenty
  zone         = "${var.region}-b"

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = 30  # GB
    }
  }

  network_interface {
    network = google_compute_network.vpc.id
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
    email  = var.vm_service_account_email  # or default
    scopes = ["cloud-platform"]
  }
}
```

**`cloud-init.yaml`** (startup script that installs everything):
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
  # Enable Docker
  - systemctl enable docker
  - systemctl start docker

  # Create app user
  - useradd -r -m -G docker scoutcoach
  - mkdir -p /opt/scoutcoach
  - chown scoutcoach:scoutcoach /opt/scoutcoach

  # Clone LibreChat
  - sudo -u scoutcoach git clone https://github.com/danny-avila/LibreChat.git /opt/scoutcoach/librechat
  - cd /opt/scoutcoach/librechat

  # The actual config files (.env, librechat.yaml, docker-compose.override.yml,
  # Caddyfile, and the custom MCP server) will be deployed by the setup script
  # that runs AFTER terraform creates the VM.
  # cloud-init just gets the OS and Docker ready.

  # Install Caddy
  - curl -sS https://caddyserver.com/api/download?os=linux&arch=amd64 -o /usr/local/bin/caddy
  - chmod +x /usr/local/bin/caddy

  # Signal ready
  - touch /opt/scoutcoach/.cloud-init-complete
```

**`network.tf`**:
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

### Post-Terraform Setup Script

After `terraform apply` gives you the IP, run this from your local machine:

```bash
#!/bin/bash
# deploy-config.sh — run from your machine after terraform apply
# Usage: ./deploy-config.sh <VM_IP>

VM_IP=$1
SSH_KEY=~/.ssh/google_compute_engine  # or your key

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

  # Copy configs
  sudo -u scoutcoach cp /tmp/scout-config/.env .
  sudo -u scoutcoach cp /tmp/scout-config/librechat.yaml .
  sudo -u scoutcoach cp /tmp/scout-config/docker-compose.override.yml .

  # Copy custom MCP server
  sudo -u scoutcoach mkdir -p ./mcp-servers/scout-quest
  sudo -u scoutcoach cp -r /tmp/scout-config/mcp-server/* ./mcp-servers/scout-quest/

  # Copy Caddyfile
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

  # Start LibreChat
  sudo -u scoutcoach docker compose up -d

  # Start Caddy
  sudo systemctl enable caddy
  sudo systemctl start caddy

  echo "=== Scout Coach is live! ==="
REMOTE_SCRIPT

echo ""
echo "Done! Access at: https://scout.hexapax.com"
echo "First user to register becomes admin."
```

### Caddyfile

```
scout.hexapax.com {
    reverse_proxy localhost:3080
}
```

That's it. Caddy handles HTTPS certificates automatically.

### docker-compose.override.yml

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
      - mongo
      - redis

  # Ensure data persists across container restarts
  mongo:
    volumes:
      - mongo_data:/data/db

  redis:
    volumes:
      - redis_data:/data

volumes:
  mongo_data:
  redis_data:
```

---

## Cost Estimate (Monthly)

| Item | Cost |
|---|---|
| GCE e2-medium VM | ~$25-35 |
| 30GB persistent disk | ~$1.50 |
| Static IP | ~$3 (while attached to running VM: free) |
| Anthropic API (scout usage, ~2-3 convos/day) | ~$5-15 |
| OpenAI API (Whisper STT + TTS) | ~$2-5 |
| Gmail SMTP | Free (with existing Google Workspace) |
| **Total** | **~$35-60/month** |

To reduce costs if idle: schedule VM to stop overnight via GCP Instance Schedule.

---

## Deployment Sequence (What You Do)

### Phase 1: Infrastructure (~15 min hands-on)

```
1. Create GCP project "scout-coach" in hexapax.com console
2. Enable Compute Engine API
3. Create service account + download key
4. Clone the deploy repo (I'll provide) to your machine
5. Fill in terraform.tfvars (project ID, domain, API keys)
6. terraform init && terraform apply
7. Note the static IP from output
8. Update DNS: scout.hexapax.com → <static IP>
```

### Phase 2: Application Config (~10 min hands-on)

```
9.  Edit config/.env with your API keys
10. Run ./deploy-config.sh <VM_IP>
11. Wait ~3 minutes for containers to pull and start
12. Visit https://scout.hexapax.com
13. Register your admin account (first user)
14. Register Will's account
15. Set ALLOW_REGISTRATION=false in .env, restart
```

### Phase 3: Agent Setup (~10 min in UI)

```
16. In LibreChat UI → Agents → Create New Agent
17. Name: "Scout Coach", Model: Claude Sonnet
18. Paste system prompt (adapted from Tier 1)
19. Add scout-quest MCP server + enable all tools
20. Test with "Hi, I'm Will!" — should load quest state
```

### Phase 4: Custom MCP Development (~separate session)

```
21. Develop and test scout-quest MCP server locally
22. Deploy to VM via scp + docker compose restart
23. Iterate as needed
```

---

## What I Can Build For You Now

Given your time constraints, here's what I'd recommend we tackle in priority order:

### Today (if time permits)
1. **Terraform files** — complete, ready to `terraform apply`
2. **Config templates** — `.env`, `librechat.yaml`, `docker-compose.override.yml`, `Caddyfile`
3. **Deploy script** — `deploy-config.sh` for post-terraform setup
4. **Skeleton MCP server** — basic `get_quest_state` and `update_quest_state` working against MongoDB

### Next Session
5. **Full MCP server** — all tools (email compose, chore logging, reminders)
6. **Scout Coach agent prompt** — adapted from Tier 1 with MCP tool integration
7. **Testing and refinement**

### Later
8. **Reminder system** — cron job or scheduled process for daily chore reminders
9. **Backup script** — MongoDB dump to GCS bucket
10. **Multi-scout onboarding** — admin workflow for adding new scouts

---

## Decision Points for Jeremy

Before I start generating the files, a few choices:

1. **Domain**: Is `scout.hexapax.com` the right subdomain? You'll need to add a DNS A record.

2. **GCP Region**: `us-east4` (Virginia, closest to Atlanta)? Or `us-central1` (Iowa, cheapest)?

3. **Auth method**: Simple email/password registration, or Google OAuth via your hexapax.com workspace? OAuth is nicer (no passwords to manage) but requires setting up a Google OAuth consent screen.

4. **API providers**: Which do you want enabled from day 1?
   - Anthropic (Claude) — primary, required
   - OpenAI (GPT-4o + Whisper/TTS) — needed for voice
   - Google (Gemini) — optional fallback

5. **MCP server language**: I'd recommend Node.js (TypeScript) since LibreChat is Node-based and the MCP SDK is best supported there. Python is also viable. Preference?

6. **Immediate priority**: Should I generate the Terraform + config files now so you can deploy infrastructure today, even before the custom MCP is done? LibreChat is fully functional without the custom MCP — you'd just get standard multi-model chat with memory, voice, and image support. The Scout Quest MCP adds the specialized tools.
