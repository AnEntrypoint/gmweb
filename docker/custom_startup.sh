#!/bin/bash
# LinuxServer Webtop Custom Startup Script
# Purpose: Setup gmweb services on top of webtop base
# Runs via /custom-cont-init.d/ mechanism

set -e

# Webtop uses /config as home directory
HOME_DIR="/config"
LOG_DIR="$HOME_DIR/logs"
mkdir -p "$LOG_DIR"

log() {
  echo "[gmweb-startup] $@" | tee -a "$LOG_DIR/startup.log"
}

log "===== GMWEB STARTUP $(date) ====="

# ============================================================================
# Fix npm permissions
# ============================================================================
if [ -d "$HOME_DIR/.npm" ]; then
  log "Fixing npm cache permissions..."
  chown -R abc:abc "$HOME_DIR/.npm" 2>/dev/null || true
  log "✓ npm permissions fixed"
fi

if [ ! -d "$HOME_DIR/.npm" ]; then
  mkdir -p "$HOME_DIR/.npm"
  chown -R abc:abc "$HOME_DIR/.npm"
  log "✓ npm cache directory created"
fi

# ============================================================================
# Copy ProxyPilot config (from build-time download)
# ============================================================================
if [ -f /opt/proxypilot-config.yaml ] && [ ! -f "$HOME_DIR/config.yaml" ]; then
  log "Copying ProxyPilot config..."
  cp /opt/proxypilot-config.yaml "$HOME_DIR/config.yaml"
  chown abc:abc "$HOME_DIR/config.yaml"
  log "✓ ProxyPilot config copied"
fi

# ============================================================================
# Fix NVM directory permissions
# ============================================================================
if [ -d /usr/local/local/nvm ]; then
  log "Fixing NVM directory permissions..."
  chown -R abc:abc /usr/local/local/nvm 2>/dev/null || true
  log "✓ NVM permissions fixed"
fi

# ============================================================================
# Setup .bashrc PATH (first boot only)
# ============================================================================
BASHRC_MARKER="$HOME_DIR/.gmweb-bashrc-setup"
if [ ! -f "$BASHRC_MARKER" ]; then
  log "Setting up .bashrc PATH configuration..."

  cat >> "$HOME_DIR/.bashrc" << 'BASHRC_EOF'

# gmweb PATH setup
export NVM_DIR="/usr/local/local/nvm"
export PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin:$HOME/.local/bin:$PATH"

# Claude Code function with --dangerously-skip-permissions
ccode() { claude --dangerously-skip-permissions "$@"; }
BASHRC_EOF

  touch "$BASHRC_MARKER"
  chown abc:abc "$BASHRC_MARKER"
  log "✓ .bashrc PATH configured"
else
  log "✓ .bashrc already configured (skipping)"
fi

# ============================================================================
# Setup Claude MCP and plugins (skipped - not critical for kasmproxy)
# ============================================================================

# ============================================================================
# Setup XFCE autostart (first boot only)
# ============================================================================
AUTOSTART_DIR="$HOME_DIR/.config/autostart"
if [ ! -d "$AUTOSTART_DIR" ]; then
  log "Setting up XFCE autostart..."
  mkdir -p "$AUTOSTART_DIR"

  # Autostart terminal with shared tmux session
  cat > "$AUTOSTART_DIR/xfce4-terminal.desktop" << 'AUTOSTART_EOF'
[Desktop Entry]
Type=Application
Name=Terminal
Exec=xfce4-terminal -e "tmux new-session -A -s main bash"
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
AUTOSTART_EOF

  # Autostart File Manager in browser
  cat > "$AUTOSTART_DIR/file-manager.desktop" << 'AUTOSTART_EOF'
[Desktop Entry]
Type=Application
Name=File Manager
Exec=firefox http://localhost/files
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
StartupDelay=5
AUTOSTART_EOF

  chown -R abc:abc "$AUTOSTART_DIR"
  log "✓ XFCE autostart configured"
else
  log "✓ XFCE autostart already configured (skipping)"
fi

# ============================================================================
# Clear supervisor logs on fresh boot (prevent persistent volume cache)
# ============================================================================
SUPERVISOR_LOG="$LOG_DIR/supervisor.log"
if [ -f "$SUPERVISOR_LOG" ]; then
  log "Clearing stale supervisor log from previous boot..."
  > "$SUPERVISOR_LOG"
  log "✓ Supervisor log cleared"
else
  log "✓ No prior supervisor log found (fresh deployment)"
fi

# ============================================================================
# Setup nginx configuration and authentication
# ============================================================================
NGINX_CONF_SRC="/opt/gmweb-startup/nginx-sites-enabled-default"
NGINX_CONF_DEST="/etc/nginx/sites-enabled/default"
HTPASSWD_FILE="/etc/nginx/.htpasswd"

if [ -f "$NGINX_CONF_SRC" ]; then
  log "Configuring nginx..."
  cp "$NGINX_CONF_SRC" "$NGINX_CONF_DEST"
  log "✓ Nginx config updated"
else
  log "WARNING: nginx config template not found at $NGINX_CONF_SRC (skipping)"
fi

# Setup htpasswd for basic auth (if PASSWORD is set)
if [ -z "$PASSWORD" ]; then
  log "WARNING: PASSWORD not set, nginx auth will not work"
else
  # Generate apr1 hash for the password
  HASH=$(echo "$PASSWORD" | openssl passwd -apr1 -stdin)
  if [ -z "$HASH" ]; then
    log "ERROR: Failed to generate password hash"
  else
    # Write htpasswd file (this script runs as root via LinuxServer init system)
    echo "abc:$HASH" > "$HTPASSWD_FILE"
    chmod 644 "$HTPASSWD_FILE"
    log "✓ HTTP Basic Auth configured (abc:****)"
  fi
fi

# Validate nginx config
if command -v nginx &> /dev/null; then
  if nginx -t 2>/dev/null; then
    log "✓ Nginx config valid"
    # Try to reload nginx (may fail if not running yet, that's OK)
    nginx -s reload 2>/dev/null || log "Note: nginx reload skipped (may not be running yet)"
  else
    log "WARNING: Nginx config has errors (continuing anyway)"
  fi
fi

# ============================================================================
# Start supervisor
# ============================================================================
log "Starting gmweb supervisor..."

# Export HOME for supervisor
export HOME="$HOME_DIR"

if [ -f /opt/gmweb-startup/start.sh ]; then
  # Run start.sh and capture exit code
  bash /opt/gmweb-startup/start.sh 2>&1 | tee -a "$LOG_DIR/startup.log"
  START_EXIT_CODE=$?
  if [ $START_EXIT_CODE -ne 0 ]; then
    log "WARNING: start.sh exited with code $START_EXIT_CODE (supervisor may have failed to start)"
    # Continue anyway - don't exit, Webtop can still provide limited functionality
  fi
else
  log "ERROR: start.sh not found at /opt/gmweb-startup/start.sh"
  exit 1
fi

# Check for user startup hook
if [ -f "$HOME_DIR/startup.sh" ]; then
  log "Running user startup hook..."
  bash "$HOME_DIR/startup.sh" 2>&1 | tee -a "$LOG_DIR/startup.log"
  log "User startup hook completed"
fi

log "===== GMWEB STARTUP COMPLETE ====="
exit 0
