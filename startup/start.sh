#!/bin/bash
# gmweb Startup Script - Launches supervisor
# Called from custom_startup.sh on EVERY boot

set -o pipefail
HOME_DIR="${HOME:-/config}"
LOG_DIR="$HOME_DIR/logs"
NVM_DIR="${NVM_DIR:-$HOME_DIR/nvm}"

unset NPM_CONFIG_PREFIX

# Ensure NVM_DIR exists
if [ ! -d "$NVM_DIR" ]; then
  echo "ERROR: NVM_DIR does not exist: $NVM_DIR"
  exit 1
fi

# Try to source .bashrc first (handles non-login shells)
if [ -f "$HOME_DIR/.bashrc" ]; then
  . "$HOME_DIR/.bashrc" 2>/dev/null || true
fi

# Source NVM to load node/npm into PATH
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
else
  echo "WARNING: NVM script not found at $NVM_DIR/nvm.sh, using fallback"
fi

# If nvm.sh didn't load node, add it to PATH manually
NODE_BIN="$(which node 2>/dev/null)"
if [ -z "$NODE_BIN" ] && [ -d "$NVM_DIR/versions/node" ]; then
  LATEST_NODE=$(ls -1 "$NVM_DIR/versions/node" | sort -V | tail -1)
  if [ -n "$LATEST_NODE" ]; then
    NODE_BIN="$NVM_DIR/versions/node/$LATEST_NODE/bin/node"
    PATH="$NVM_DIR/versions/node/$LATEST_NODE/bin:$PATH"
    export PATH
  fi
fi

# Final verification
if [ -z "$NODE_BIN" ] || [ ! -f "$NODE_BIN" ]; then
  echo "ERROR: Node.js not found in PATH or NVM. NVM_DIR=$NVM_DIR"
  echo "DEBUG: NODE_BIN=$NODE_BIN"
  echo "DEBUG: Checking NVM directory structure:"
  ls -la "$NVM_DIR/versions/node/" 2>&1 | head -20 || echo "NVM versions directory not found or empty"
  exit 1
fi
SUPERVISOR_LOG="$LOG_DIR/supervisor.log"

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
