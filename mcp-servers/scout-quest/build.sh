#!/bin/bash
set -e
cd "$(dirname "$0")"
npm install
npx tsc
echo "Build complete. Outputs in dist/"
