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
# User Home Directory Setup (first boot only)
# ============================================================================

HOMEDIR_MARKER="/home/kasm-user/.gmweb-homedir-setup"
if [ ! -f "$HOMEDIR_MARKER" ]; then
  log "Setting up user home directory structure (first boot)..."

  # Create user configuration directories
  mkdir -p /home/kasm-user/.config/autostart
  mkdir -p /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml
  mkdir -p /home/kasm-user/.tmux
  mkdir -p /home/kasm-user/logs

  # Create user tmux configuration
  cat > /home/kasm-user/.tmux.conf <<'TMUX_EOF'
set -g history-limit 2000
set -g terminal-overrides "xterm*:smcup@:rmcup@"
set-option -g allow-rename off
TMUX_EOF
  chmod 644 /home/kasm-user/.tmux.conf

  # Create XFCE4 Terminal configuration
  cat > /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-terminal.xml <<'XFCE_EOF'
<?xml version="1.0" encoding="UTF-8"?>

<channel name="xfce4-terminal" version="1.0">
  <property name="font-name" type="string" value="Monospace 9"/>
</channel>
XFCE_EOF
  chmod 644 /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-terminal.xml

  # Create XFCE4 Desktop entries
  cat > /home/kasm-user/.config/autostart/terminal.desktop <<'DESKTOP_EOF'
[Desktop Entry]
Type=Application
Name=Terminal
Exec=/usr/bin/xfce4-terminal
OnlyShowIn=XFCE;
DESKTOP_EOF
  chmod 644 /home/kasm-user/.config/autostart/terminal.desktop

  cat > /home/kasm-user/.config/autostart/chromium.desktop <<'DESKTOP_EOF'
[Desktop Entry]
Type=Application
Name=Chromium
Exec=/usr/bin/chromium
OnlyShowIn=XFCE;
DESKTOP_EOF
  chmod 644 /home/kasm-user/.config/autostart/chromium.desktop

  cat > /home/kasm-user/.config/autostart/ext.desktop <<'DESKTOP_EOF'
[Desktop Entry]
Type=Application
Name=Chrome Extension Installer
Exec=bash -c "chromium --install-extension=cnobjgjejhbkcjbakdkdkhchpijecafo"
OnlyShowIn=XFCE;
DESKTOP_EOF
  chmod 644 /home/kasm-user/.config/autostart/ext.desktop

  # Clone and setup WebSSH2 (if not already present)
  if [ ! -d /home/kasm-user/webssh2 ]; then
    log "Setting up WebSSH2..."
    git clone https://github.com/billchurch/webssh2.git /home/kasm-user/webssh2
    cd /home/kasm-user/webssh2
    npm install --production
    cd -
    log "✓ WebSSH2 installed"
  fi

  # Clone and setup File Manager (if not already present)
  if [ ! -d /home/kasm-user/node-file-manager-esm ]; then
    log "Setting up File Manager..."
    git clone https://github.com/BananaAcid/node-file-manager-esm.git /home/kasm-user/node-file-manager-esm
    cd /home/kasm-user/node-file-manager-esm
    npm install --production
    cd -
    log "✓ File Manager installed"
  fi

  # Set proper permissions on all created directories and files
  chown -R kasm-user:kasm-user /home/kasm-user/.config /home/kasm-user/.tmux /home/kasm-user/logs /home/kasm-user/.tmux.conf
  chmod 755 /home/kasm-user/.config /home/kasm-user/.config/autostart /home/kasm-user/.config/xfce4 /home/kasm-user/.config/xfce4/xfconf /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml /home/kasm-user/.tmux /home/kasm-user/logs
  chmod 755 /home/kasm-user/{webssh2,node-file-manager-esm} 2>/dev/null || true
  find /home/kasm-user/{webssh2,node-file-manager-esm} -type d 2>/dev/null -exec chmod 755 {} \;

  touch "$HOMEDIR_MARKER"
  log "✓ User home directory setup complete (first boot only)"
else
  log "Skipping user home setup (already configured)"
fi

# ============================================================================
# Fix runtime permissions (volume-mounted directories)
# ============================================================================

# Fix permissions on mounted volumes (runs as root at startup)
# Note: Desktop/Downloads symlink is created by KasmWeb, do not interfere
chmod 755 /home/kasm-user/{Desktop,Desktop/Uploads} 2>/dev/null || true

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
