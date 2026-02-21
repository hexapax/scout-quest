#!/bin/bash
# Build the admin app (TypeScript compile + Docker image)
# Usage: ./scripts/build-admin.sh [--docker]
#   No args:   TypeScript compile only
#   --docker:  Also build Docker image

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ADMIN_DIR="${PROJECT_ROOT}/admin"

cd "$ADMIN_DIR"

echo "=== Installing dependencies ==="
source ~/.nvm/nvm.sh
nvm use 24 2>/dev/null
npm install

echo ""
echo "=== Compiling TypeScript ==="
npx tsc

echo ""
echo "TypeScript build complete: admin/dist/"

if [ "${1:-}" = "--docker" ]; then
  echo ""
  echo "=== Building Docker image ==="
  docker build -t scout-admin .
  echo ""
  echo "Docker image built: scout-admin"
fi
