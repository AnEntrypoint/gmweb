#!/bin/bash
# KasmWeb Custom Startup Script - Optimized for fast boot
# Launches the gmweb modular supervisor system with nohup and exits immediately
# KasmWeb continues initialization while supervisor runs in background

set -e

# Configuration from environment (with defaults)
GMWEB_STARTUP_ENABLED="${GMWEB_STARTUP_ENABLED:-true}"
GMWEB_STARTUP_DIR="${GMWEB_STARTUP_DIR:-/home/kasm-user/gmweb-startup}"
GMWEB_NODE_PATH="${GMWEB_NODE_PATH:-/usr/local/local/nvm/versions/node/v23.11.1/bin/node}"
GMWEB_LOG_DIR="${GMWEB_LOG_DIR:-/home/kasm-user/logs}"
GMWEB_SUPERVISOR_LOG="${GMWEB_SUPERVISOR_LOG:-$GMWEB_LOG_DIR/supervisor.log}"

# Exit if startup is disabled
if [ "$GMWEB_STARTUP_ENABLED" != "true" ]; then
    echo "gmweb startup disabled via GMWEB_STARTUP_ENABLED=false"
    exit 0
fi

# Ensure log directory exists
mkdir -p "$GMWEB_LOG_DIR"

# Log startup event
echo "===== STARTUP $(date) =====" | tee -a "$GMWEB_LOG_DIR/startup.log"

# Validate supervisor directory exists
if [ ! -d "$GMWEB_STARTUP_DIR" ]; then
    echo "ERROR: GMWEB_STARTUP_DIR not found: $GMWEB_STARTUP_DIR" | tee -a "$GMWEB_LOG_DIR/startup.log"
    exit 1
fi

# Validate Node.js binary exists
if [ ! -x "$GMWEB_NODE_PATH" ]; then
    echo "ERROR: GMWEB_NODE_PATH not found or not executable: $GMWEB_NODE_PATH" | tee -a "$GMWEB_LOG_DIR/startup.log"
    exit 1
fi

# Check if supervisor already running (idempotent - survives container restart)
SUPERVISOR_PID_FILE="$GMWEB_LOG_DIR/.supervisor.pid"
if [ -f "$SUPERVISOR_PID_FILE" ]; then
    OLD_PID=$(cat "$SUPERVISOR_PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Supervisor already running (PID: $OLD_PID) - skipping restart" | tee -a "$GMWEB_LOG_DIR/startup.log"
        exit 0
    fi
fi

# Start supervisor in background with nohup and exit IMMEDIATELY
# This allows KasmWeb to continue initializing without blocking
cd "$GMWEB_STARTUP_DIR"
nohup "$GMWEB_NODE_PATH" index.js >> "$GMWEB_SUPERVISOR_LOG" 2>&1 &

SUPERVISOR_PID=$!
echo "$SUPERVISOR_PID" > "$SUPERVISOR_PID_FILE"
echo "gmweb supervisor started (PID: $SUPERVISOR_PID) - exiting to unblock KasmWeb" | tee -a "$GMWEB_LOG_DIR/startup.log"

# Exit successfully - DO NOT WAIT - KasmWeb needs to continue
exit 0
