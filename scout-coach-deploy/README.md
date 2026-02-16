# Scout Coach — Tier 2 Deployment

Self-hosted AI Scout Coach on LibreChat, deployed to GCP with Terraform.

## What You Get

- **LibreChat** — ChatGPT-like UI with multi-model support
- **5 AI providers**: Anthropic (Claude), OpenAI (GPT), Google (Gemini), DeepSeek, OpenRouter (Llama/Gemma/Mistral/Qwen)
- **"Sign in with Google"** — scouts use existing accounts, no new passwords
- **Voice mode** — STT/TTS that stays in-context (unlike claude.ai voice)
- **Image upload** — scouts can photograph hardware for troubleshooting
- **Persistent memory** — AI remembers quest progress across conversations
- **HTTPS** — automatic Let's Encrypt via Caddy
- **Custom MCP** — (Phase 2) specialized Scout Quest tools for state tracking, email, chores

## Cost Estimate

| Item | Monthly |
|---|---|
| GCE e2-medium VM | ~$25-35 |
| Anthropic API (primary, moderate use) | ~$5-15 |
| OpenAI API (voice STT/TTS) | ~$2-5 |
| DeepSeek (cheap experimentation) | ~$0-2 |
| OpenRouter (open model access) | ~$0-5 |
| **Total** | **~$35-60** |

## Prerequisites

1. **[gcloud CLI](https://cloud.google.com/sdk/docs/install)** installed and logged in (`gcloud auth login`)
2. **[Terraform](https://developer.hashicorp.com/terraform/install)** >= 1.5 installed
3. **GCP project** created in hexapax.com console
4. **Domain** you control (e.g., `scout.hexapax.com`)
5. **API keys** (get these before Step 6):
   - Anthropic: https://console.anthropic.com/settings/keys
   - OpenAI: https://platform.openai.com/api-keys
   - DeepSeek (optional): https://platform.deepseek.com/api_keys
   - OpenRouter (optional): https://openrouter.ai/keys

## File Structure

```
scout-coach-deploy/
├── bootstrap.sh                    ← Run first: sets up GCP prerequisites
├── deploy-config.sh                ← Run after terraform: pushes config to VM
├── terraform/
│   ├── main.tf                     ← Provider + state backend
│   ├── variables.tf                ← Input variables
│   ├── network.tf                  ← VPC + firewall rules
│   ├── compute.tf                  ← VM + static IP
│   ├── storage.tf                  ← Backup bucket
│   ├── outputs.tf                  ← IP address + next steps
│   ├── cloud-init.yaml             ← VM startup (Docker, Caddy, LibreChat clone)
│   └── terraform.tfvars.example    ← Copy to terraform.tfvars and edit
└── config/
    ├── .env                        ← API keys + auth config (edit this!)
    ├── librechat.yaml              ← App config: memory, speech, AI providers
    └── docker-compose.override.yml ← Volume mounts for persistence
```

## Deployment Steps

### Step 1: Bootstrap GCP (~3 min)

Creates the Terraform state bucket, service account, and enables APIs.

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
project_id = "scout-coach"          # your actual project ID
domain     = "scout.hexapax.com"    # your subdomain
```

If your project ID isn't `scout-coach`, also update the bucket name in `terraform/main.tf`:
```hcl
backend "gcs" {
  bucket = "YOUR-PROJECT-ID-tfstate"    # must match bootstrap
}
```

### Step 3: Deploy Infrastructure (~3 min)

```bash
cd terraform
terraform init
terraform plan      # review — should create: VPC, subnet, 2 firewall rules, static IP, VM, bucket
terraform apply     # type 'yes'
```

**Note the output!** You need the `external_ip` for DNS.

### Step 4: Update DNS (~1 min, then wait for propagation)

Create an A record:
```
scout.hexapax.com  →  <external_ip from terraform output>
```

You can proceed to the next steps while DNS propagates — Caddy will retry automatically.

### Step 5: Set Up Google OAuth (~5 min)

1. Go to **[GCP Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)**
   - Make sure you're in the correct project
2. Click **CONFIGURE CONSENT SCREEN** (if not done yet)
   - Choose **External**
   - App name: "Scout Coach"
   - Support email: your email
   - Authorized domains: `hexapax.com`
   - Save
3. Go to **Credentials** → **+ CREATE CREDENTIALS** → **OAuth client ID**
   - Application type: **Web application**
   - Name: "Scout Coach"
   - Authorized JavaScript origins: `https://scout.hexapax.com`
   - Authorized redirect URIs: `https://scout.hexapax.com/oauth/google/callback`
4. Copy the **Client ID** and **Client Secret**

### Step 6: Configure the App (~5 min)

Edit `config/.env` — fill in at minimum:

```bash
GOOGLE_CLIENT_ID=<paste from step 5>
GOOGLE_CLIENT_SECRET=<paste from step 5>
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Gmail for password reset (needs app password)
EMAIL_USERNAME=your@gmail.com
EMAIL_PASSWORD=xxxx-xxxx-xxxx-xxxx   # Gmail app password
EMAIL_FROM=your@gmail.com
```

For optional providers, either fill in the key or leave the placeholder:
```bash
DEEPSEEK_API_KEY=<FILL_IN_OR_LEAVE>   # leave as-is to skip
OPENROUTER_KEY=<FILL_IN_OR_LEAVE>     # leave as-is to skip
```

### Step 7: Deploy the App (~5 min)

```bash
cd ..    # back to repo root
./deploy-config.sh <external_ip>
# Or: ./deploy-config.sh gcloud
```

This uploads your config, generates security keys, pulls Docker images, and starts everything.

### Step 8: Register Accounts (~2 min)

1. Visit `https://scout.hexapax.com`
   - First HTTPS request may take ~30s while Caddy gets the Let's Encrypt cert
2. Click **"Sign in with Google"** — register YOUR account first (becomes admin)
3. Have Will sign in with his Google account
4. Edit `config/.env`: set `ALLOW_REGISTRATION=false`
5. Re-run: `./deploy-config.sh <ip>` to lock registration

## Day-to-Day Operations

### SSH into the VM
```bash
gcloud compute ssh scout-coach-vm --zone=us-east4-b
```

### View logs
```bash
cd /opt/scoutcoach/librechat
docker compose logs -f api          # LibreChat logs
docker compose logs -f mongo        # MongoDB logs
sudo journalctl -u caddy -f         # Caddy/HTTPS logs
```

### Restart LibreChat
```bash
cd /opt/scoutcoach/librechat
docker compose restart
```

### Update LibreChat
```bash
cd /opt/scoutcoach/librechat
git pull
docker compose pull
docker compose up -d
```

### Update config (after editing locally)
```bash
./deploy-config.sh <ip>    # re-uploads and restarts
```

### Add another social provider
Uncomment the relevant lines in `config/.env` (GitHub, Discord) and add the
provider to `SOCIAL_LOGIN_PROVIDERS`. Re-deploy config.

## What's Next: Phase 2 — Scout Quest MCP

The custom TypeScript MCP server will add:
- Per-scout quest state tracking (merit badges, hardware, budget)
- Email composition with pre-filled To/CC
- Chore logging with streak tracking
- Reminder system
- Hardware price lookups

This will be developed in a separate session and deployed by updating
`config/librechat.yaml` to uncomment the MCP server block and restarting.
