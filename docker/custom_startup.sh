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
# .bashrc Environment Setup (first boot only)
# ============================================================================

BASHRC_MARKER="/home/kasm-user/.gmweb-bashrc-setup"
if [ ! -f "$BASHRC_MARKER" ]; then
  log "Setting up .bashrc environment variables (first boot)..."

  cat >> /home/kasm-user/.bashrc <<'BASHRC_EOF'

# GMWeb Environment Setup
export NVM_DIR="/usr/local/local/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"

export NODE_PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin"
export PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"

export WEBSSH2_LISTEN_PORT=9999
export PORT=9998

# Auto-attach to tmux
if [ -z "$TMUX" ] && [ -z "$SSH_CONNECTION" ]; then
  exec tmux attach-session -t main 2>/dev/null || exec tmux new-session -s main
fi
BASHRC_EOF

  touch "$BASHRC_MARKER"
  log "✓ .bashrc environment variables set (first boot only)"
else
  log "Skipping .bashrc setup (already configured)"
fi

# ============================================================================
# Fix runtime permissions (volume-mounted directories)
# ============================================================================

# Fix permissions on mounted volumes (runs as root at startup)
chmod 755 /home/kasm-user/{Desktop,Downloads,Desktop/Uploads} 2>/dev/null || true

# Create symlink for KasmWeb Downloads directory
rm -rf /home/kasm-user/Desktop/Downloads
ln -sf /home/kasm-user/Downloads /home/kasm-user/Desktop/Downloads

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
