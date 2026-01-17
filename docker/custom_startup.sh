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
# Fix npm permissions (root-owned files from build time)
# ============================================================================
# npm cache may have been created as root during docker build
# This blocks npx and npm commands for kasm-user

if [ -d /home/kasm-user/.npm ]; then
  log "Fixing npm cache permissions..."
  sudo chown -R kasm-user:kasm-user /home/kasm-user/.npm
  log "✓ npm permissions fixed"
fi

# Create npm cache dir with correct ownership if missing
if [ ! -d /home/kasm-user/.npm ]; then
  mkdir -p /home/kasm-user/.npm
  log "✓ npm cache directory created"
fi

# ============================================================================
# Fix Claude Code UI permissions (root-owned from build time)
# ============================================================================
# The claudecodeui directory is created as root during docker build
# Need to fix ownership so the server can write to database and temp files

if [ -d /opt/claudecodeui ]; then
  log "Fixing Claude Code UI permissions..."
  sudo chown -R kasm-user:kasm-user /opt/claudecodeui
  log "✓ Claude Code UI permissions fixed"

  # Create kasm_user in Claude Code UI database with VNC_PW
  log "Setting up Claude Code UI user..."
  cd /opt/claudecodeui
  node -e "
    const Database = require('better-sqlite3');
    const bcrypt = require('bcrypt');
    const vncPw = process.env.VNC_PW || '';
    if (!vncPw) { console.log('No VNC_PW, skipping'); process.exit(0); }
    const db = new Database('/opt/claudecodeui/server/database/auth.db');
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get('kasm_user');
    if (user) {
      const hash = bcrypt.hashSync(vncPw, 10);
      db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, 'kasm_user');
      console.log('Updated kasm_user password');
    } else {
      const hash = bcrypt.hashSync(vncPw, 10);
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('kasm_user', hash);
      console.log('Created kasm_user');
    }
    db.close();
  " 2>&1 | tee -a "$LOG_DIR/startup.log"
  cd - > /dev/null
  log "✓ Claude Code UI user configured"
fi

# ============================================================================
# Setup .bashrc PATH (first boot only)
# ============================================================================
# Add NVM and local bin paths to .bashrc for interactive shells
# Uses marker file to prevent duplicate entries on container restarts

BASHRC_MARKER="/home/kasm-user/.gmweb-bashrc-setup"
if [ ! -f "$BASHRC_MARKER" ]; then
  log "Setting up .bashrc PATH configuration..."

  # Add NVM and local paths to .bashrc
  cat >> /home/kasm-user/.bashrc << 'BASHRC_EOF'

# gmweb PATH setup
export NVM_DIR="/usr/local/local/nvm"
export PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin:$HOME/.local/bin:$PATH"

# Claude Code alias with --dangerously-skip-permissions
alias ccode='claude --dangerously-skip-permissions'
BASHRC_EOF

  touch "$BASHRC_MARKER"
  log "✓ .bashrc PATH configured"
else
  log "✓ .bashrc already configured (skipping)"
fi

# ============================================================================
# Setup XFCE autostart (first boot only)
# ============================================================================
# Create autostart directory and desktop entries for apps that should start on login

AUTOSTART_DIR="/home/kasm-user/.config/autostart"
if [ ! -d "$AUTOSTART_DIR" ]; then
  log "Setting up XFCE autostart..."
  mkdir -p "$AUTOSTART_DIR"

  # Autostart terminal
  cat > "$AUTOSTART_DIR/xfce4-terminal.desktop" << 'AUTOSTART_EOF'
[Desktop Entry]
Type=Application
Name=Terminal
Exec=xfce4-terminal
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
AUTOSTART_EOF

  log "✓ XFCE autostart configured"
else
  log "✓ XFCE autostart already configured (skipping)"
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
