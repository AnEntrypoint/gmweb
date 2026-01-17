#!/bin/bash
# gmweb Startup Script - Launches supervisor and exits
# Called from custom_startup.sh on EVERY boot
# Simple: start supervisor with nohup in background and exit

LOG_DIR="/home/kasm-user/logs"
NODE_BIN="/usr/local/local/nvm/versions/node/v23.11.1/bin/node"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Start supervisor with nohup in background
nohup "$NODE_BIN" /home/kasm-user/gmweb-startup/index.js >> "$LOG_DIR/supervisor.log" 2>&1 &

# Exit immediately - KasmWeb needs to continue initializing
exit 0
