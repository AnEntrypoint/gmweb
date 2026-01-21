#!/bin/bash
# LinuxServer Webtop Custom Startup Script
# Purpose: Setup gmweb services on top of webtop base
# Runs via /custom-cont-init.d/ mechanism

set -e

# Webtop uses /config as home directory
HOME_DIR="/config"
LOG_DIR="$HOME_DIR/logs"
mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR"
chown abc:abc "$LOG_DIR"

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
# Setup NHFS (Next-HTTP-File-Server) - File manager with drag & drop uploads
# ============================================================================
log "Setting up NHFS (file manager with uploads)..."

NHFS_DIR="/opt/nhfs"
if [ ! -d "$NHFS_DIR" ]; then
  log "Cloning NHFS repository..."
  git clone https://github.com/AliSananS/NHFS.git "$NHFS_DIR" 2>&1 | head -3
  # Fix ownership immediately after cloning
  chown -R abc:abc "$NHFS_DIR" 2>/dev/null || true
  log "✓ NHFS cloned"
else
  log "Updating NHFS repository..."
  cd "$NHFS_DIR"
  # Fix permissions and git ownership issues
  sudo chown -R abc:abc "$NHFS_DIR" 2>/dev/null || true
  git config --global --add safe.directory "$NHFS_DIR" 2>/dev/null || true
  # Use timeout to prevent hanging on network issues
  timeout 10 git pull origin main > /dev/null 2>&1 || log "Note: NHFS git pull timed out or failed"
  log "✓ NHFS updated"
fi

if [ -d "$NHFS_DIR" ]; then
  cd "$NHFS_DIR"
  
  # Patch NHFS next.config.js to add basePath for /files routing
  log "Patching NHFS next.config.js for /files basePath..."
  if [ -f "$NHFS_DIR/next.config.js" ]; then
    # Only add basePath if it's not already there
    if ! grep -q "basePath:" "$NHFS_DIR/next.config.js"; then
      # Insert basePath after output: 'standalone',
      sed -i "/output: 'standalone',/a\\  basePath: '/files'," "$NHFS_DIR/next.config.js"
      log "✓ NHFS patched with basePath: '/files'"
    else
      log "✓ NHFS already has basePath configured"
    fi
  fi
  
  # Run NHFS setup in background so supervisor can start immediately
  # This prevents the long build process from blocking other services
  {
    log "Installing NHFS dependencies (background)..."
    npm install --legacy-peer-deps --production=false > /dev/null 2>&1
    
    log "Building NHFS (background - may take several minutes)..."
    npm run build > /dev/null 2>&1
    
    log "Pruning dev dependencies (background)..."
    npm prune --production > /dev/null 2>&1
    
    log "✓ NHFS ready at $NHFS_DIR/dist/server.js"
  } &
  
  log "✓ NHFS setup started in background (supervisor will start immediately)"
else
  log "ERROR: NHFS setup failed"
fi

# ============================================================================
# Setup Glootie-OC (OpenCode AI Plugin) - Install or update on boot
# ============================================================================
log "Setting up Glootie-OC (OpenCode plugin)..."

GLOOTIE_DIR="$HOME_DIR/.opencode/glootie-oc"

# Ensure parent directory exists with proper ownership
mkdir -p "$(dirname "$GLOOTIE_DIR")"
chown abc:abc "$(dirname "$GLOOTIE_DIR")" 2>/dev/null || true

# Run Glootie setup in background so startup continues immediately
{
  if [ ! -d "$GLOOTIE_DIR" ]; then
    log "Cloning Glootie-OC repository (background)..."
    sudo -u abc git clone https://github.com/AnEntrypoint/glootie-oc.git "$GLOOTIE_DIR" 2>&1 | head -3
    # Fix ownership immediately after cloning
    chown -R abc:abc "$GLOOTIE_DIR" 2>/dev/null || true
    log "✓ Glootie-OC cloned"
    
    if [ -d "$GLOOTIE_DIR" ]; then
      log "Running Glootie-OC setup (background)..."
      cd "$GLOOTIE_DIR"
      bash ./setup.sh > /dev/null 2>&1
      log "✓ Glootie-OC setup complete"
    fi
  else
    log "Updating Glootie-OC repository (background)..."
    cd "$GLOOTIE_DIR"
    # Fix permissions and git ownership issues
    sudo chown -R abc:abc "$GLOOTIE_DIR" 2>/dev/null || true
    sudo -u abc git config --global --add safe.directory "$GLOOTIE_DIR" 2>/dev/null || true
    # Use timeout to prevent hanging on network issues
    timeout 10 sudo -u abc git pull origin main > /dev/null 2>&1 || log "Note: Glootie-OC git pull timed out or failed"
    log "Running Glootie-OC setup (background)..."
    bash ./setup.sh > /dev/null 2>&1
    log "✓ Glootie-OC updated"
  fi
} &

log "✓ Glootie-OC setup started in background (startup continues immediately)"

# ============================================================================
# Clean up Chromium profile locks to prevent startup failures
# ============================================================================
log "Cleaning up Chromium profile locks..."
rm -rf "$HOME_DIR/.config/chromium/Singleton" 2>/dev/null || true
rm -rf "$HOME_DIR/.config/chromium/SingletonSocket" 2>/dev/null || true
rm -rf "$HOME_DIR/.config/chromium/.com.google.Chrome.* " 2>/dev/null || true
rm -rf "$HOME_DIR/.config/chromium/Profile*/.*lock" 2>/dev/null || true
find "$HOME_DIR/.config/chromium" -name "*lock*" -delete 2>/dev/null || true
find "$HOME_DIR/.config/chromium" -name "*Socket*" -delete 2>/dev/null || true
# Also clean First Run file to prevent splash screen
rm -f "$HOME_DIR/.config/chromium/Default/First Run" 2>/dev/null || true
log "✓ Chromium profile locks cleaned"

# ============================================================================
# Ensure XFCE session infrastructure is ready before autostart
# This prevents xfconfd/session manager failures
# ============================================================================
log "Setting up XFCE session infrastructure..."

# Ensure D-Bus is ready for session manager
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/run/dbus/system_bus_socket"

# Wait for X server to be ready (with timeout)
for i in {1..30}; do
  if DISPLAY=:1.0 xset q &>/dev/null; then
    log "✓ X server is ready"
    break
  fi
  if [ $i -eq 30 ]; then
    log "⚠ X server took too long to be ready, proceeding anyway"
  fi
  sleep 0.2
done

# Give session services time to initialize (critical timing fix)
sleep 1

# ============================================================================
# Setup XFCE autostart (every boot - regenerate with current env vars)
# ============================================================================
AUTOSTART_DIR="$HOME_DIR/.config/autostart"
mkdir -p "$AUTOSTART_DIR"

log "Configuring XFCE autostart (with current environment variables)..."

# Autostart terminal with shared tmux session
# Add startup delay to ensure tmux session is created first
# Use wrapper script to handle any tmux issues
mkdir -p "${HOME}/.local/bin"
cat > "${HOME}/.local/bin/terminal-autostart.sh" << 'TERM_SCRIPT_EOF'
#!/bin/bash
# Terminal autostart wrapper - ensures tmux session exists before attaching
export DISPLAY=:1.0
sleep 2  # Wait for tmux to create session
# Attach to main tmux session
exec tmux attach-session -t main 2>/dev/null || exec bash -i -l
TERM_SCRIPT_EOF
chmod +x "${HOME}/.local/bin/terminal-autostart.sh"

# Create terminal autostart wrapper script (so .desktop file can execute it directly)
mkdir -p "${HOME}/.local/bin"
cat > "${HOME}/.local/bin/terminal-launcher.sh" << 'TERM_LAUNCHER_EOF'
#!/bin/bash
# Terminal launcher for XFCE autostart
exec xfce4-terminal -e /config/.local/bin/terminal-autostart.sh
TERM_LAUNCHER_EOF
chmod +x "${HOME}/.local/bin/terminal-launcher.sh"

cat > "$AUTOSTART_DIR/xfce4-terminal.desktop" << AUTOSTART_EOF
[Desktop Entry]
Type=Application
Name=Terminal
Comment=Shared tmux session
Exec=$HOME_DIR/.local/bin/terminal-launcher.sh
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
StartupDelay=10
AUTOSTART_EOF

# Create files launcher wrapper script
mkdir -p "${HOME}/.local/bin"
cat > "${HOME}/.local/bin/files-launcher.sh" << 'FILES_LAUNCHER_EOF'
#!/bin/bash
# Files launcher for XFCE autostart
exec chromium http://localhost/files
FILES_LAUNCHER_EOF
chmod +x "${HOME}/.local/bin/files-launcher.sh"

# Autostart File Manager in browser
cat > "$AUTOSTART_DIR/file-manager.desktop" << 'AUTOSTART_EOF'
[Desktop Entry]
Type=Application
Name=File Manager
Exec=$HOME_DIR/.local/bin/files-launcher.sh
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
StartupDelay=5
AUTOSTART_EOF

# Create Chromium autostart wrapper script (always regenerate with current PASSWORD/FQDN)
mkdir -p "${HOME}/.local/bin"
cat > "${HOME}/.local/bin/chromium-autostart.sh" << 'SCRIPT_EOF'
#!/bin/bash
# Chromium autostart wrapper - launches Chromium with OpenCode page
export DISPLAY=:1.0

LOG_FILE="/tmp/chromium-autostart.log"
echo "[$(date)] Starting chromium autostart" >> "$LOG_FILE"

# Get credentials from environment (set during boot in custom_startup.sh)
PASSWORD="${PASSWORD:-Joker@212Joker@212}"
FQDN="${COOLIFY_FQDN:-127.0.0.1}"

# Aggressively clean Chromium profile locks (stale locks from previous boots)
echo "[$(date)] Cleaning stale Chromium profile locks..." >> "$LOG_FILE"
rm -rf "${HOME}/.config/chromium/Singleton" 2>/dev/null || true
rm -rf "${HOME}/.config/chromium/SingletonSocket" 2>/dev/null || true
rm -rf "${HOME}/.config/chromium/Profile"*/.*lock 2>/dev/null || true
rm -rf "${HOME}/.config/chromium/Profile*/Lock 2>/dev/null || true
rm -rf "${HOME}/.config/chromium/Default/.*lock 2>/dev/null || true
find "${HOME}/.config/chromium" -name "*lock*" -delete 2>/dev/null || true
find "${HOME}/.config/chromium" -name "*Socket*" -delete 2>/dev/null || true

# Wait for nginx to be ready (max 30 seconds)
echo "[$(date)] Waiting for nginx on port 80/443..." >> "$LOG_FILE"
for i in {1..30}; do
  if ss -tlnp 2>/dev/null | grep -qE ":(80|443)"; then
    echo "[$(date)] nginx ready" >> "$LOG_FILE"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "[$(date)] WARNING: nginx not ready after 30s, proceeding anyway" >> "$LOG_FILE"
  fi
  sleep 1
done

# Determine URL based on domain
if [ "$FQDN" = "127.0.0.1" ]; then
  URL="http://abc:${PASSWORD}@127.0.0.1/code/"
else
  URL="https://abc:${PASSWORD}@${FQDN}/code/"
fi

echo "[$(date)] Launching Chromium to: $FQDN" >> "$LOG_FILE"
# Use isolated temp profile to avoid stale locks persisting from previous boots
CHROME_PROFILE_DIR="/tmp/chromium-profile-$$"
mkdir -p "$CHROME_PROFILE_DIR"
/usr/bin/chromium \
  --user-data-dir="$CHROME_PROFILE_DIR" \
  --new-window \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-default-apps \
  "$URL" >> "$LOG_FILE" 2>&1 &
CHROMIUM_PID=$!
echo "[$(date)] Chromium launched with PID $CHROMIUM_PID (profile: $CHROME_PROFILE_DIR)" >> "$LOG_FILE"
SCRIPT_EOF
chmod +x "${HOME}/.local/bin/chromium-autostart.sh"

# Autostart Chromium with Playwriter Extension Debugger
cat > "$AUTOSTART_DIR/chromium.desktop" << 'AUTOSTART_EOF'
[Desktop Entry]
Type=Application
Name=Chromium
Comment=Open Chromium with Playwriter
Icon=chromium
Exec=bash -c "sleep 5 && ~/.local/bin/chromium-autostart.sh"
Categories=Network;WebBrowser;
X-GNOME-Autostart-enabled=true
Terminal=false
StartupNotify=false
AUTOSTART_EOF

chown -R abc:abc "$AUTOSTART_DIR" "${HOME}/.local/bin"
log "✓ XFCE autostart configured (regenerated with current env vars)"

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
NGINX_CONF_AVAILABLE="/etc/nginx/sites-available/default"
NGINX_CONF_ENABLED="/etc/nginx/sites-enabled/default"
HTPASSWD_FILE="/etc/nginx/.htpasswd"

if [ -f "$NGINX_CONF_SRC" ]; then
  log "Configuring nginx..."
  # Copy to both locations to ensure it's always used
  # sites-available is the source, sites-enabled may be symlinked
  cp "$NGINX_CONF_SRC" "$NGINX_CONF_AVAILABLE"
  # If sites-enabled/default is not a symlink, also update it
  if [ ! -L "$NGINX_CONF_ENABLED" ]; then
    cp "$NGINX_CONF_SRC" "$NGINX_CONF_ENABLED"
  fi
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
     # Write htpasswd file with both abc and opencode users (script runs as root)
     echo "abc:$HASH" > "$HTPASSWD_FILE"
     echo "opencode:$HASH" >> "$HTPASSWD_FILE"
     chmod 644 "$HTPASSWD_FILE"
     log "✓ HTTP Basic Auth configured (abc:**** and opencode:****)"
   fi
fi

# Validate and reload nginx config
if command -v nginx &> /dev/null; then
  if nginx -t 2>/dev/null; then
    log "✓ Nginx config valid"
    # Force reload nginx to pick up the new config
    # Try init.d reload first, then pkill -HUP as fallback
    if sudo /etc/init.d/nginx reload 2>/dev/null; then
      log "✓ Nginx reloaded on ports 80/443"
    else
      # If reload fails, try sending HUP signal directly
      if sudo pkill -HUP nginx 2>/dev/null; then
        log "✓ Nginx reloaded (SIGHUP)"
      else
        log "Note: nginx reload skipped (may not be running yet)"
      fi
    fi
  else
    log "WARNING: Nginx config has errors (continuing anyway)"
  fi
fi

# ============================================================================
# Start supervisor as abc user (not root)
# ============================================================================
log "Starting gmweb supervisor as abc user..."

if [ -f /opt/gmweb-startup/start.sh ]; then
  # Run start.sh as abc user with proper HOME and environment
  # sudo -u abc: run as abc user
  # -H: set HOME to /config (from /etc/passwd)
  # -E: preserve environment variables (PASSWORD, etc)
  # bash /opt/gmweb-startup/start.sh: run the startup script
  sudo -u abc -H -E bash /opt/gmweb-startup/start.sh 2>&1 | tee -a "$LOG_DIR/startup.log"
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

# ============================================================================
# Fix ownership of any files created as root during startup
# ============================================================================
log "Fixing ownership of /config files created as root..."
chown -R abc:abc "$HOME_DIR" 2>/dev/null || true
log "✓ Ownership fixed for /config directory"

log "===== GMWEB STARTUP COMPLETE ====="
exit 0
