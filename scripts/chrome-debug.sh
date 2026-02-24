#!/bin/bash
# Launch Windows Chrome with remote debugging enabled (for CDP access from WSL2)
#
# Prerequisites:
#   - Close ALL Chrome windows first (Chrome ignores the flag if another instance is running)
#   - WSL2 mirrored networking mode enabled in .wslconfig
#
# Verify it's working:
#   curl -s http://127.0.0.1:9222/json/version

CHROME="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
DEBUG_PORT=9222
USER_DATA_DIR="C:\\Temp\\chrome-debug-profile"

if ! [ -f "$CHROME" ]; then
  echo "Chrome not found at: $CHROME"
  exit 1
fi

echo "Launching Chrome with remote debugging on port $DEBUG_PORT..."
echo "Make sure all other Chrome windows are closed first!"
"$CHROME" --remote-debugging-port=$DEBUG_PORT --user-data-dir="$USER_DATA_DIR" &>/dev/null &
disown

# Wait for CDP endpoint to become available
for i in {1..10}; do
  if curl -s http://127.0.0.1:$DEBUG_PORT/json/version &>/dev/null; then
    echo "Chrome debugging ready at http://127.0.0.1:$DEBUG_PORT"
    curl -s http://127.0.0.1:$DEBUG_PORT/json/version | python3 -m json.tool 2>/dev/null
    exit 0
  fi
  sleep 1
done

echo "Warning: Chrome launched but CDP endpoint not responding after 10s"
echo "Check that no other Chrome instances were running"
exit 1
