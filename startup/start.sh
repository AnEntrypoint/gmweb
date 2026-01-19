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
echo "[start.sh] kasmproxy.js exists: $([ -f /opt/gmweb-startup/kasmproxy.js ] && echo YES || echo NO)"
echo "[start.sh] config.json exists: $([ -f /opt/gmweb-startup/config.json ] && echo YES || echo NO)"
echo "[start.sh] ls /opt/gmweb-startup:"
ls -la /opt/gmweb-startup/ | grep -E "\.js|\.json" | head -10
echo "[start.sh] Starting supervisor in background..."

# Background supervisor and capture PID
"$NODE_BIN" /opt/gmweb-startup/index.js >> "$LOG_DIR/supervisor.log" 2>&1 &
SUPERVISOR_PID=$!

echo "[start.sh] Supervisor spawned as PID: $SUPERVISOR_PID"
echo "[start.sh] Logs: $LOG_DIR/supervisor.log"
echo "[start.sh] Tailing logs for 5 seconds..."

# Show first few lines of supervisor log
sleep 2
tail -20 "$LOG_DIR/supervisor.log" 2>/dev/null || echo "[start.sh] No supervisor log yet"

# Wait for supervisor to establish (don't block forever though)
echo "[start.sh] Waiting for supervisor..."
sleep 10
echo "[start.sh] Checking supervisor status..."

if kill -0 $SUPERVISOR_PID 2>/dev/null; then
  echo "[start.sh] Supervisor is running (PID: $SUPERVISOR_PID)"
else
  echo "[start.sh] Supervisor exited unexpectedly - check logs"
  tail -50 "$LOG_DIR/supervisor.log" 2>/dev/null || echo "[start.sh] No supervisor log"
fi

# Keep this script running so supervisor stays as child of this process
wait
