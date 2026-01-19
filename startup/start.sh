#!/bin/bash
# gmweb Startup Script - Launches supervisor
# Called from custom_startup.sh on EVERY boot

set -o pipefail
HOME_DIR="${HOME:-/config}"
LOG_DIR="$HOME_DIR/logs"
NODE_BIN="/usr/local/local/nvm/versions/node/v23.11.1/bin/node"
SUPERVISOR_LOG="$LOG_DIR/supervisor.log"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Diagnostics
BOOT_TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[start.sh] === STARTUP DIAGNOSTICS (Boot: $BOOT_TIMESTAMP) ==="
echo "[start.sh] HOME_DIR=$HOME_DIR"
echo "[start.sh] LOG_DIR=$LOG_DIR"
echo "[start.sh] NODE_BIN=$NODE_BIN (exists: $([ -f "$NODE_BIN" ] && echo YES || echo NO))"
echo "[start.sh] supervisor index.js (exists: $([ -f /opt/gmweb-startup/index.js ] && echo YES || echo NO))"
echo "[start.sh] kasmproxy.js (exists: $([ -f /opt/gmweb-startup/kasmproxy.js ] && echo YES || echo NO))"
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

   # Give kasmproxy time to start and bind port 80
   sleep 3

   # Verify kasmproxy is listening
   if command -v lsof &> /dev/null; then
     if lsof -i :80 2>/dev/null | grep -q LISTEN; then
       echo "[start.sh] ✓ kasmproxy is LISTENING on port 80"
     else
       echo "[start.sh] ✗ kasmproxy NOT listening on port 80 (may still be starting)"
     fi
   fi
else
  echo "[start.sh] ✗ Supervisor exited (check logs)"
  [ -f "$SUPERVISOR_LOG" ] && tail -50 "$SUPERVISOR_LOG"
fi

# Keep this script running (supervisor runs forever, but we want to survive if it somehow exits)
while true; do
  sleep 60
done
