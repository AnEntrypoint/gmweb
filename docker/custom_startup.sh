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
# Fix runtime permissions (volume-mounted directories)
# ============================================================================

log "Fixing runtime permissions on mounted volumes..."

# Fix Desktop and Downloads permissions (happens AFTER volume mount)
chmod 755 /home/kasm-user/Desktop 2>/dev/null || true
chmod 755 /home/kasm-user/Downloads 2>/dev/null || true

# Ensure Desktop/Uploads directory exists and is writable
mkdir -p /home/kasm-user/Desktop/Uploads
chmod 755 /home/kasm-user/Desktop/Uploads

# Remove Desktop/Downloads if it's a directory (conflicts with symlink)
if [ -d /home/kasm-user/Desktop/Downloads ] && [ ! -L /home/kasm-user/Desktop/Downloads ]; then
  rm -rf /home/kasm-user/Desktop/Downloads
  log "✓ Removed conflicting Downloads directory"
fi

# Create Downloads symlink for KasmWeb
if [ ! -L /home/kasm-user/Desktop/Downloads ]; then
  ln -sf /home/kasm-user/Downloads /home/kasm-user/Desktop/Downloads
  log "✓ Downloads symlink created"
fi

log "✓ Runtime permissions fixed"

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
