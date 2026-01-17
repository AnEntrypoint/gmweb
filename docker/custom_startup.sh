#!/bin/bash
# KasmWeb Custom Startup Script - Minimal Orchestrator
# Purpose: Clean up stale state, start gmweb supervisor, exit
# Does NOT interfere with KasmWeb profile initialization
# Cleans only stale entries from previous failed deployments

set -e

LOG_DIR="/home/kasm-user/logs"
mkdir -p "$LOG_DIR"

log() {
  echo "[custom_startup] $@" | tee -a "$LOG_DIR/startup.log"
}

log "===== CUSTOM STARTUP $(date) ====="

# ============================================================================
# Clean up stale state from previous failed deployments
# ============================================================================
# If Desktop/Downloads exists as a DIRECTORY (not symlink), remove it
# This prevents KasmWeb profile verification from getting stuck
# We ONLY remove the specific conflict, not interfering with KasmWeb setup

if [ -d /home/kasm-user/Desktop/Downloads ] && [ ! -L /home/kasm-user/Desktop/Downloads ]; then
  log "Cleaning stale Desktop/Downloads directory from previous deployment..."
  rm -rf /home/kasm-user/Desktop/Downloads
  log "✓ Stale directory removed, KasmWeb can now create symlink"
fi

# ============================================================================
# Start supervisor
# ============================================================================

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
