#!/bin/bash
# gmweb Startup Script - Launches supervisor and exits
# Called from custom_startup.sh on EVERY boot
# Simple: start supervisor with nohup in background and exit

# Use LinuxServer webtop path (/config) instead of old KasmWeb path (/home/kasm-user)
HOME_DIR="${HOME:-/config}"
LOG_DIR="$HOME_DIR/logs"
NODE_BIN="/usr/local/local/nvm/versions/node/v23.11.1/bin/node"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Start supervisor with nohup in background
nohup "$NODE_BIN" /opt/gmweb-startup/index.js >> "$LOG_DIR/supervisor.log" 2>&1 &

# Exit immediately - Webtop needs to continue initializing
exit 0
