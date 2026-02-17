# Scout Quest

Two self-hosted LibreChat instances on one GCP VM, deployed with Terraform.

- **ai-chat.hexapax.com** — Full model access for you (all providers, no restrictions)
- **scout-quest.hexapax.com** — Locked-down Scout Quest instance (curated presets, memory agent)

## Architecture

```
Internet
  ├── ai-chat.hexapax.com ──→ Caddy ──→ localhost:3080 ──→ /opt/scoutcoach/ai-chat/
  └── scout-quest.hexapax.com ──→ Caddy ──→ localhost:3081 ──→ /opt/scoutcoach/scout-quest/
```

Each instance is a fully independent LibreChat stack with its own MongoDB, Redis, and API containers. Docker Compose derives project names from the directory, so no container name conflicts.

**Access control:** Google OAuth in "Testing" mode — only emails you add as test users in the GCP Console can sign in. Each instance gets its own OAuth client ID.

**Resources:** ~1.5-2GB RAM total on e2-medium (4GB). Comfortable fit.

## What You Get

| Feature | ai-chat | scout-quest |
|---|---|---|
| All AI providers (Claude, GPT, Gemini, DeepSeek, OpenRouter) | Yes | Via curated presets |
| Model selection | Unrestricted | Locked (`modelSpecs.enforce: true`) |
| Voice mode (STT/TTS) | Yes | Yes |
| Persistent memory | No | Yes (quest progress, preferences) |
| MCP server support | No | Yes (Phase 2) |
| Google OAuth | Yes | Yes |

## Cost Estimate

| Item | Monthly |
|---|---|
| GCE e2-medium VM (both instances) | ~$25-35 |
| Anthropic API | ~$5-15 |
| OpenAI API (voice STT/TTS) | ~$2-5 |
| DeepSeek (cheap experimentation) | ~$0-2 |
| OpenRouter (open model access) | ~$0-5 |
| **Total** | **~$35-60** |

## Prerequisites

1. **[gcloud CLI](https://cloud.google.com/sdk/docs/install)** installed and logged in
2. **[Terraform](https://developer.hashicorp.com/terraform/install)** >= 1.5
3. **GCP project** created
4. **Two subdomains** pointing to the same IP (e.g., `ai-chat.hexapax.com` + `scout-quest.hexapax.com`)
5. **API keys**: Anthropic, OpenAI, optionally DeepSeek and OpenRouter

## File Structure

```
scout-quest/
├── README.md                                 ← you are here
├── bootstrap.sh                              ← Run first: sets up GCP prerequisites
├── deploy-config.sh                          ← Manage secrets in GCS + deploy to VM
├── .gitignore
├── config/
│   ├── ai-chat/
│   │   ├── .env.example                      ← Copy to .env and fill in secrets
│   │   ├── librechat.yaml                    ← Full-access config (no restrictions)
│   │   └── docker-compose.override.yml       ← Standard volume mounts
│   └── scout-quest/
│       ├── .env.example                      ← Copy to .env and fill in secrets
│       ├── librechat.yaml                    ← Locked config (modelSpecs, memory, MCP)
│       └── docker-compose.override.yml       ← Volume mounts + MCP server mount
├── terraform/
│   ├── main.tf                               ← Provider + state backend
│   ├── variables.tf                          ← domain_aichat + domain_scout vars
│   ├── network.tf                            ← VPC + firewall rules
│   ├── compute.tf                            ← VM + static IP
│   ├── storage.tf                            ← Backup bucket
│   ├── outputs.tf                            ← IP address + next steps
│   ├── cloud-init.yaml                       ← VM startup (clones LibreChat twice)
│   └── terraform.tfvars.example              ← Copy to terraform.tfvars and edit
└── docs/
    ├── architecture.md
    ├── mcp-server-design.md
    └── future-research.md
```

## Deployment Steps

### Step 1: Bootstrap GCP (~3 min)

```bash
chmod +x bootstrap.sh deploy-config.sh
./bootstrap.sh scout-coach    # replace with your project ID
```

### Step 2: Configure Terraform (~1 min)

```bash
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
```

Edit `terraform/terraform.tfvars`:
```hcl
project_id    = "scout-coach"
domain_aichat = "ai-chat.hexapax.com"
domain_scout  = "scout-quest.hexapax.com"
```

### Step 3: Deploy Infrastructure (~3 min)

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

Note the `external_ip` from the output.

### Step 4: Update DNS

Create two A records pointing to the same IP:
```
ai-chat.hexapax.com      →  <external_ip>
scout-quest.hexapax.com  →  <external_ip>
```

### Step 5: Set Up Google OAuth (~10 min)

You need **two separate OAuth client IDs** (one per instance).

For each instance:
1. Go to **[GCP Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)**
2. **OAuth consent screen** → set to **Testing** mode
   - Add your email (and scout emails for the scout instance) as **test users**
   - Only test users can sign in — this is your access control
3. **Credentials** → **+ CREATE CREDENTIALS** → **OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://ai-chat.hexapax.com` (or `scout-quest`)
   - Authorized redirect URIs: `https://ai-chat.hexapax.com/oauth/google/callback`
4. Copy the **Client ID** and **Client Secret**

### Step 6: Configure Both Instances (~5 min)

```bash
cp config/ai-chat/.env.example config/ai-chat/.env
cp config/scout-quest/.env.example config/scout-quest/.env
```

Edit each `.env` file — fill in at minimum:
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (different for each!)
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `NTFY_TOPIC` (scout-quest only — pick a unique topic name)

Then push secrets to GCS:
```bash
./deploy-config.sh push
```

### Step 6b: Set Up ntfy Notifications

1. Install the [ntfy app](https://ntfy.sh) on Will's iPad
2. Subscribe to the topic you chose for `NTFY_TOPIC` (e.g., `scout-quest-will`)
3. That's it — notifications will arrive when the MCP server or cron sends them

### Step 7: Deploy (~5 min)

```bash
./deploy-config.sh <external_ip>
# Or: ./deploy-config.sh gcloud
```

This pulls `.env` from GCS, combines with git-tracked configs, uploads to VM, generates security keys, pulls Docker images, and starts both stacks.

### Step 8: Register Accounts

1. Visit both URLs — first HTTPS request takes ~30s for Let's Encrypt certs
2. Register YOUR account on both instances first (becomes admin)
3. Add scout emails as test users in the GCP OAuth consent screen
4. Have scouts sign in on `scout-quest.hexapax.com`
5. Set `ALLOW_REGISTRATION=false` in both `.env` files
6. Push and re-deploy: `./deploy-config.sh push && ./deploy-config.sh gcloud`

**Note:** Password sign-up is disabled (`ALLOW_PASSWORD_SIGN_UP=false`). All users must sign in via Google OAuth. Only emails added as test users in the GCP OAuth consent screen can access the app.

## Day-to-Day Operations

### SSH into the VM
```bash
gcloud compute ssh scout-coach-vm --zone=us-east4-b
```

### View logs
```bash
# AI Chat
cd /opt/scoutcoach/ai-chat && docker compose logs -f api

# Scout Quest
cd /opt/scoutcoach/scout-quest && docker compose logs -f api

# Caddy (HTTPS)
sudo journalctl -u caddy -f
```

### Restart an instance
```bash
cd /opt/scoutcoach/ai-chat && docker compose restart
cd /opt/scoutcoach/scout-quest && docker compose restart
```

### Update LibreChat
```bash
cd /opt/scoutcoach/ai-chat && git pull && docker compose pull && docker compose up -d
cd /opt/scoutcoach/scout-quest && git pull && docker compose pull && docker compose up -d
```

### Update config
```bash
# After editing .env files (secrets):
./deploy-config.sh push           # save to GCS
./deploy-config.sh gcloud         # deploy (pulls from GCS + git-tracked configs)

# After editing librechat.yaml or docker-compose.override.yml (git-tracked):
git add . && git commit           # commit changes
./deploy-config.sh gcloud         # deploy picks up git-tracked files directly

# On a new machine:
./deploy-config.sh pull           # restore .env files from GCS
```
