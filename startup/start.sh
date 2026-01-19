#!/bin/bash
# gmweb Startup Script - Launches supervisor
# Called from custom_startup.sh on EVERY boot

HOME_DIR="${HOME:-/config}"
LOG_DIR="$HOME_DIR/logs"
NODE_BIN="/usr/local/local/nvm/versions/node/v23.11.1/bin/node"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Write startup diagnostics to console (will appear in docker logs)
echo "[start.sh] HOME_DIR=$HOME_DIR"
echo "[start.sh] LOG_DIR=$LOG_DIR"
echo "[start.sh] NODE_BIN=$NODE_BIN"
echo "[start.sh] NODE_BIN exists: $([ -f "$NODE_BIN" ] && echo YES || echo NO)"
echo "[start.sh] supervisor index.js exists: $([ -f /opt/gmweb-startup/index.js ] && echo YES || echo NO)"
echo "[start.sh] Starting supervisor directly (not backgrounded for now)..."

# Start supervisor directly (not backgrounded) - output goes to docker logs
"$NODE_BIN" /opt/gmweb-startup/index.js

# If we get here, supervisor exited
echo "[start.sh] Supervisor exited"
exit 0
