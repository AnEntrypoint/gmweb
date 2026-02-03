#!/bin/bash
# gmweb Startup Script - Launches supervisor
# Called from custom_startup.sh on EVERY boot

set -o pipefail
HOME_DIR="${HOME:-/config}"
LOG_DIR="$HOME_DIR/logs"

# Source beforestart hook to initialize environment
# This ensures consistent environment across all services
if [ -f "$HOME_DIR/beforestart" ]; then
  . "$HOME_DIR/beforestart"
else
  echo "ERROR: beforestart hook not found at $HOME_DIR/beforestart"
  exit 1
fi

# Verify critical tools are available
if [ -z "$(command -v node)" ]; then
  echo "ERROR: Node.js not found in PATH after sourcing gmweb environment"
  exit 1
fi

# CRITICAL: Verify bunx is available before starting services
if ! command -v bunx &>/dev/null; then
  if ! command -v bun &>/dev/null; then
    echo "ERROR: bunx and bun not available in PATH"
    echo "ERROR: BUN_INSTALL=$BUN_INSTALL"
    echo "ERROR: PATH=$PATH"
    exit 1
  fi
  # If bun exists but not bunx, create symlink
  BUN_PATH=$(command -v bun)
  BUN_DIR=$(dirname "$BUN_PATH")
  ln -sf "$BUN_PATH" "$BUN_DIR/bunx" 2>/dev/null || true
fi

# If nvm.sh didn't load node, add it to PATH manually
SUPERVISOR_LOG="$LOG_DIR/supervisor.log"
NODE_BIN="$(which node)"

# CRITICAL: Ensure PASSWORD is exported to supervisor
# PASSWORD is passed from custom_startup.sh to start.sh
if [ -z "$PASSWORD" ]; then
  echo "WARNING: PASSWORD not set, using fallback 'password'"
  export PASSWORD="password"
fi

# Ensure log directory exists with proper permissions
mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR"
# Ensure abc user can write to logs directory
if [ "$(id -u)" = "0" ]; then
  chown -R abc:abc "$LOG_DIR"
fi

# Diagnostics
BOOT_TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[start.sh] === STARTUP DIAGNOSTICS (Boot: $BOOT_TIMESTAMP) ==="
echo "[start.sh] HOME_DIR=$HOME_DIR"
echo "[start.sh] LOG_DIR=$LOG_DIR"
echo "[start.sh] NODE_BIN=$NODE_BIN (exists: $([ -f "$NODE_BIN" ] && echo YES || echo NO))"
echo "[start.sh] supervisor index.js (exists: $([ -f /opt/gmweb-startup/index.js ] && echo YES || echo NO))"
echo "[start.sh] nginx status (running: $(pgrep -c nginx >/dev/null && echo YES || echo NO))"
echo "[start.sh] config.json (exists: $([ -f /opt/gmweb-startup/config.json ] && echo YES || echo NO))"

# CRITICAL: Verify bunx availability
BUNX_PATH=$(command -v bunx 2>/dev/null || echo "NOT FOUND")
BUN_PATH=$(command -v bun 2>/dev/null || echo "NOT FOUND")
echo "[start.sh] bunx=$BUNX_PATH"
echo "[start.sh] bun=$BUN_PATH"
if [ "$BUNX_PATH" = "NOT FOUND" ] && [ "$BUN_PATH" = "NOT FOUND" ]; then
  echo "[start.sh] ERROR: bunx and bun are NOT available!"
  echo "[start.sh] BUN_INSTALL=$BUN_INSTALL"
  echo "[start.sh] PATH=$PATH"
else
  echo "[start.sh] ✓ bunx/bun available for services"
fi
echo "[start.sh] === STARTING SUPERVISOR ==="

# Start supervisor in background with unbuffered output
export NODE_OPTIONS="--no-warnings"

# Try to use stdbuf if available, otherwise run directly
if command -v stdbuf &> /dev/null; then
  stdbuf -oL -eL "$NODE_BIN" /opt/gmweb-startup/index.js >> "$SUPERVISOR_LOG" 2>&1 &
else
  "$NODE_BIN" /opt/gmweb-startup/index.js >> "$SUPERVISOR_LOG" 2>&1 &
fi
SUPERVISOR_PID=$!

echo "[start.sh] Supervisor PID: $SUPERVISOR_PID"
echo "[start.sh] Supervisor log: $SUPERVISOR_LOG"

# Give supervisor time to start and write logs
sleep 3

# Show supervisor logs (tail to see fresh startup)
if [ -f "$SUPERVISOR_LOG" ]; then
  TOTAL_LINES=$(wc -l < "$SUPERVISOR_LOG")
  echo "[start.sh] === SUPERVISOR LOG (last 50 lines of $TOTAL_LINES total) ==="
  tail -50 "$SUPERVISOR_LOG"
  echo "[start.sh] === END LOG ==="
else
  echo "[start.sh] WARNING: No supervisor log file found yet"
fi

# Check if supervisor is running
sleep 5
if kill -0 $SUPERVISOR_PID 2>/dev/null; then
  echo "[start.sh] ✓ Supervisor is RUNNING (PID: $SUPERVISOR_PID)"

    # Give services time to fully start
    sleep 3

    # Verify nginx is listening on port 80
    if command -v ss &> /dev/null; then
      if ss -tlnp 2>/dev/null | grep -q ":80.*LISTEN"; then
        echo "[start.sh] ✓ nginx is LISTENING on port 80"
      else
        echo "[start.sh] ✗ nginx NOT listening on port 80 (may still be starting)"
      fi
    fi
else
  echo "[start.sh] ✗ Supervisor exited (check logs)"
  [ -f "$SUPERVISOR_LOG" ] && tail -50 "$SUPERVISOR_LOG"
fi

# Exit after starting supervisor
# The supervisor runs as a background process (detached) and will continue running
# We must return from this script to allow s6-rc to proceed with other services
echo "[start.sh] === STARTUP COMPLETE ==="
exit 0
