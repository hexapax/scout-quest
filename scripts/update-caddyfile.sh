#!/bin/bash
# Update the Caddyfile on the VM to include all three proxy rules
# Usage: ./scripts/update-caddyfile.sh

set -euo pipefail

REMOTE_SCRIPT='
sudo tee /etc/caddy/Caddyfile > /dev/null << CADDYEOF
ai-chat.hexapax.com {
    reverse_proxy localhost:3080
}

scout-quest.hexapax.com {
    reverse_proxy localhost:3081
}

admin.hexapax.com {
    reverse_proxy localhost:3082
}
CADDYEOF

sudo systemctl reload caddy
echo "Caddyfile updated and Caddy reloaded"
'

gcloud compute ssh scout-coach-vm --zone=us-east4-b --command="$REMOTE_SCRIPT"
