#!/bin/bash
# Update the full Caddyfile on scout-coach-vm.
#
# WARNING: this script REPLACES the entire /etc/caddy/Caddyfile on the VM.
# It is the single source of truth for Caddy config on that host, so every
# vhost that should be served must be listed below — including ones for
# projects outside scout-quest (jeremy-memory, mcp-proxy, hexapax.com).
# If you add a new vhost, add it here too.
#
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

# jeremy-memory — webviewer + MCP server + Grafana
jeremy.hexapax.com {
    # MCP server — direct, token-authenticated (no oauth2-proxy)
    handle /mcp* {
        reverse_proxy localhost:8100
    }

    # Grafana dashboards
    handle /grafana* {
        reverse_proxy localhost:3000
    }

    # Everything else through oauth2-proxy (Google login)
    handle {
        reverse_proxy localhost:4180
    }
}

# hexapax.com — link board / portal (auth via oauth2-proxy)
hexapax.com {
    # Rewrite root to the link board route
    rewrite / /view/links
    # Proxy through oauth2-proxy for Google login
    reverse_proxy localhost:4180
}

# mcp-proxy — HTTP bridge for stdio MCP servers
# (perplexity, brave, newsapi, gdelt, courtlistener)
mcp-proxy.hexapax.com {
    reverse_proxy localhost:8200
}
CADDYEOF

sudo systemctl reload caddy
echo "Caddyfile updated and Caddy reloaded"
'

gcloud compute ssh scout-coach-vm --zone=us-east4-b --project=scout-assistant-487523 --command="$REMOTE_SCRIPT"
