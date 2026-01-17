#!/bin/bash
# KasmWeb Custom Startup Script - Minimal Orchestrator
# Purpose: Start gmweb supervisor and exit
# Does NOT interfere with KasmWeb profile initialization
# All user-specific setup is delegated to supervisor or second boot

set -e

LOG_DIR="/home/kasm-user/logs"
mkdir -p "$LOG_DIR"

log() {
  echo "[custom_startup] $@" | tee -a "$LOG_DIR/startup.log"
}

log "===== CUSTOM STARTUP $(date) ====="
log "Starting gmweb supervisor..."

if [ -f /opt/gmweb-startup/start.sh ]; then
  bash /opt/gmweb-startup/start.sh 2>&1 | tee -a "$LOG_DIR/startup.log"
else
  log "ERROR: start.sh not found at /opt/gmweb-startup/start.sh"
  exit 1
fi

# Check for user startup hook
if [ -f /home/kasm-user/startup.sh ]; then
  log "Running user startup hook..."
  bash /home/kasm-user/startup.sh 2>&1 | tee -a "$LOG_DIR/startup.log"
  log "User startup hook completed"
fi

log "===== CUSTOM STARTUP COMPLETE ====="
exit 0
