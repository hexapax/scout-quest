#!/bin/bash
# Update the Caddyfile on the VM to include all three proxy rules
# Usage: ./scripts/update-caddyfile.sh

set -euo pipefail

REMOTE_SCRIPT='
sudo tee /etc/caddy/Caddyfile > /dev/null << CADDYEOF
# Scout Quest app — scouts, parents, leaders
scout-quest.hexapax.com {
    reverse_proxy localhost:3090
}

# API endpoint — ElevenLabs and other integrations
api.hexapax.com {
    reverse_proxy localhost:3090
}

# ai-chat — full-access LibreChat instance for the admin
ai-chat.hexapax.com {
    reverse_proxy localhost:3080
}

# Legacy aliases
voice-api.hexapax.com {
    reverse_proxy localhost:3090
}
voice-chat.hexapax.com {
    reverse_proxy localhost:3090
}

# AdminJS panel
admin.hexapax.com {
    reverse_proxy localhost:3082
}
CADDYEOF

sudo systemctl reload caddy
echo "Caddyfile updated and Caddy reloaded"
'

gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --command="$REMOTE_SCRIPT"
