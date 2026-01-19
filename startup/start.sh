#!/bin/bash
# gmweb Startup Script - Launches supervisor and exits
# Called from custom_startup.sh on EVERY boot

HOME_DIR="${HOME:-/config}"
LOG_DIR="$HOME_DIR/logs"
NODE_BIN="/usr/local/local/nvm/versions/node/v23.11.1/bin/node"

# Ensure log directory exists with proper permissions
mkdir -p "$LOG_DIR"
chmod 777 "$LOG_DIR" || true

# Verify Node.js is available
if [ ! -f "$NODE_BIN" ]; then
  echo "ERROR: Node.js not found at $NODE_BIN" | tee "$LOG_DIR/startup-error.log"
  exit 1
fi

# Verify supervisor index.js exists
if [ ! -f "/opt/gmweb-startup/index.js" ]; then
  echo "ERROR: Supervisor not found at /opt/gmweb-startup/index.js" | tee "$LOG_DIR/startup-error.log"
  exit 1
fi

# Start supervisor with nohup in background
# Redirect both stdout and stderr to capture all logs
nohup "$NODE_BIN" /opt/gmweb-startup/index.js > "$LOG_DIR/supervisor.log" 2>&1 &
SUPERVISOR_PID=$!

# Give supervisor 2 seconds to start and check if it's still running
sleep 2
if ps -p $SUPERVISOR_PID > /dev/null 2>&1; then
  echo "Supervisor started successfully (PID: $SUPERVISOR_PID)"
else
  echo "ERROR: Supervisor failed to start (PID $SUPERVISOR_PID is no longer running)" | tee "$LOG_DIR/startup-error.log"
  # Show supervisor log for debugging
  if [ -f "$LOG_DIR/supervisor.log" ]; then
    echo "=== Supervisor log ===" | tee -a "$LOG_DIR/startup-error.log"
    cat "$LOG_DIR/supervisor.log" | tee -a "$LOG_DIR/startup-error.log"
  fi
  exit 1
fi

exit 0
