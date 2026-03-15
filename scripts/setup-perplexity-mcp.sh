#!/usr/bin/env bash
# Setup Perplexity MCP server for Claude Code on devbox
# Configures for both jeremy_hexapax_com and devuser accounts
# Usage: Pass API key as first argument
set -euo pipefail

PERPLEXITY_KEY="${1:?Usage: $0 <PERPLEXITY_API_KEY>}"
echo "Got API key (${#PERPLEXITY_KEY} chars)"

# Configure for jeremy_hexapax_com (IAP SSH user, has existing Claude Code setup)
echo "Configuring for jeremy_hexapax_com..."
sudo -u jeremy_hexapax_com bash -c "
  claude mcp add --scope user perplexity \
    --env PERPLEXITY_API_KEY='$PERPLEXITY_KEY' \
    -- npx -y @perplexity-ai/mcp-server
"
echo "Done: jeremy_hexapax_com"

# Configure for devuser (service/deploy user)
echo "Configuring for devuser..."
sudo -u devuser bash -c "
  claude mcp add --scope user perplexity \
    --env PERPLEXITY_API_KEY='$PERPLEXITY_KEY' \
    -- npx -y @perplexity-ai/mcp-server
"
echo "Done: devuser"

echo "Perplexity MCP server configured for both users."
echo "Tools available: perplexity_ask, perplexity_search, perplexity_research, perplexity_reason"
