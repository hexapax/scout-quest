#!/bin/bash
# Wrapper to run commands with nvm Node.js 24
# Usage: ./scripts/nvm-run.sh <command> [args...]
# Example: ./scripts/nvm-run.sh npx tsc --noEmit
#          ./scripts/nvm-run.sh npm install
#          ./scripts/nvm-run.sh npx vitest run

set -euo pipefail

source ~/.nvm/nvm.sh
nvm use 24 2>/dev/null

exec "$@"
