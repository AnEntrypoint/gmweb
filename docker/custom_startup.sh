#!/bin/bash
# KasmWeb Custom Startup Script - Orchestrator
# Runs on EVERY boot:
#   1. bash start.sh (supervisor startup)
#   2. Check for user startup.sh hook
#   3. Exit to unblock KasmWeb desktop

set -e

LOG_DIR="/home/kasm-user/logs"
mkdir -p "$LOG_DIR"

log() {
  echo "[custom_startup] $@" | tee -a "$LOG_DIR/startup.log"
}

log "===== CUSTOM STARTUP $(date) ====="

# ============================================================================
# Start supervisor
# ============================================================================

log "Starting gmweb supervisor..."

if [ -f /home/kasm-user/gmweb-startup/start.sh ]; then
  bash /home/kasm-user/gmweb-startup/start.sh 2>&1 | tee -a "$LOG_DIR/startup.log"
else
  log "ERROR: start.sh not found"
  exit 1
fi

# ============================================================================
# User startup hook
# ============================================================================

if [ -f /home/kasm-user/startup.sh ]; then
  log "Running user startup hook..."
  bash /home/kasm-user/startup.sh 2>&1 | tee -a "$LOG_DIR/startup.log"
  log "User startup hook completed"
fi

# ============================================================================
# Complete
# ============================================================================

log "===== CUSTOM STARTUP COMPLETE ====="
exit 0
