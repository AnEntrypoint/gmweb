#!/bin/bash
# gmweb Startup Script - Launches supervisor and exits
# Called from custom_startup.sh on EVERY boot

HOME_DIR="${HOME:-/config}"
LOG_DIR="$HOME_DIR/logs"
NODE_BIN="/usr/local/local/nvm/versions/node/v23.11.1/bin/node"

# Ensure log directory exists
mkdir -p "$LOG_DIR" 2>/dev/null || true

# Start supervisor with nohup in background
# Redirect both stdout and stderr to capture all logs
nohup "$NODE_BIN" /opt/gmweb-startup/index.js > "$LOG_DIR/supervisor.log" 2>&1 &

# Exit with success - don't block on supervisor
exit 0
