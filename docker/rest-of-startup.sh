#!/bin/bash
# REST-OF-STARTUP.SH: Non-blocking startup phases
# This script runs async AFTER nginx-setup.sh completes successfully
# It handles: git clone, NVM, supervisor, services, module installs, XFCE
# This script is spawned with nohup by custom_startup.sh and runs in background

set +e

HOME_DIR="/config"
LOG_DIR="$HOME_DIR/logs"

log() {
  local msg="[rest-of-startup] $(date '+%Y-%m-%d %H:%M:%S') $@"
  echo "$msg"
  echo "$msg" >> "$LOG_DIR/startup.log" 2>/dev/null || echo "$msg"
  sync "$LOG_DIR/startup.log" 2>/dev/null || true
}

log "===== REST OF STARTUP PHASES (NON-BLOCKING) ====="
log "This runs async while nginx and s6-rc proceed independently"

# Get runtime directory
ABC_UID=$(id -u abc 2>/dev/null || echo 1000)
RUNTIME_DIR="/run/user/$ABC_UID"

# ===== PHASE 1: GIT CLONE =====
log "Phase 1: Git clone - get startup files and nginx config (minimal history)"

sudo rm -rf /tmp/gmweb /opt/gmweb-startup/node_modules /opt/gmweb-startup/lib \
       /opt/gmweb-startup/services /opt/gmweb-startup/package* \
       /opt/gmweb-startup/*.js /opt/gmweb-startup/*.json /opt/gmweb-startup/*.sh \
       /opt/gmweb-startup/.git 2>/dev/null || true

sudo mkdir -p /opt/gmweb-startup

# Ensure network is ready - one attempt with timeout
log "  Verifying network connectivity..."
if timeout 10 curl -fsSL --connect-timeout 5 https://api.github.com/users/AnEntrypoint >/dev/null 2>&1; then
  log "  ✓ Network verified"
else
  log "  WARNING: Network check failed, attempting clone anyway (may timeout)"
fi

# Clone with minimal history and data - much faster
rm -rf /tmp/gmweb 2>/dev/null || true
if ! timeout 120 git clone --depth 1 --filter=blob:none --single-branch --branch main \
  https://github.com/AnEntrypoint/gmweb.git /tmp/gmweb 2>&1 | tail -3; then
  log "ERROR: Git clone failed (network or GitHub unavailable)"
  exit 1
fi

if [ ! -d /tmp/gmweb/startup ]; then
  log "ERROR: Git clone completed but startup directory missing"
  exit 1
fi

log "✓ Git clone succeeded"

cp -r /tmp/gmweb/startup/* /opt/gmweb-startup/
cp /tmp/gmweb/docker/nginx-sites-enabled-default /opt/gmweb-startup/
log "✓ Startup files copied to /opt/gmweb-startup"

# ===== PHASE 1.0a: BEFORESTART/BEFOREEND HOOKS =====
log "Phase 1.0a: Setting up beforestart and beforeend hooks..."
cp /tmp/gmweb/startup/beforestart /config/beforestart
cp /tmp/gmweb/startup/beforeend /config/beforeend
chmod +x /config/beforestart /config/beforeend
chown abc:abc /config/beforestart /config/beforeend
log "✓ beforestart and beforeend hooks installed to /config/"

# ===== PHASE 1.0b: BASHRC SETUP =====
log "Phase 1.0b: Generating perfect .bashrc file..."
cat > /config/.bashrc << 'BASHRC_EOF'
#!/bin/bash
# Auto-generated .bashrc - sources beforestart hook for environment setup
# This file is regenerated on every boot to ensure perfect consistency

# Source beforestart hook for all environment variables and setup
if [ -f "${HOME}/.beforestart" ] || [ -f "${HOME}/beforestart" ]; then
  BEFORESTART_HOOK="${HOME}/beforestart"
  [ ! -f "$BEFORESTART_HOOK" ] && BEFORESTART_HOOK="${HOME}/.beforestart"
  if [ -f "$BEFORESTART_HOOK" ]; then
    . "$BEFORESTART_HOOK"
  fi
fi

# Interactive shell features (only in interactive shells)
if [ -z "$PS1" ]; then
  return
fi

# Bash history configuration
export HISTSIZE=10000
export HISTFILESIZE=20000
export HISTCONTROL=ignoredups:ignorespace

# Shell options
shopt -s histappend 2>/dev/null || true
shopt -s checkwinsize 2>/dev/null || true

# PS1 prompt
export PS1="\u@\h:\w\$ "
BASHRC_EOF
chmod 644 /config/.bashrc
log "✓ Perfect .bashrc created"

# ===== PHASE 1.0c: PROFILE SETUP =====
log "Phase 1.0c: Generating perfect .profile file..."
cat > /config/.profile << 'PROFILE_EOF'
#!/bin/bash
# Auto-generated .profile - sources beforestart hook for environment setup
# This file is regenerated on every boot to ensure perfect consistency

# Source beforestart hook for all environment variables and setup
if [ -f "${HOME}/.beforestart" ] || [ -f "${HOME}/beforestart" ]; then
  BEFORESTART_HOOK="${HOME}/beforestart"
  [ ! -f "$BEFORESTART_HOOK" ] && BEFORESTART_HOOK="${HOME}/.beforestart"
  if [ -f "$BEFORESTART_HOOK" ]; then
    . "$BEFORESTART_HOOK"
  fi
fi
PROFILE_EOF
chmod 644 /config/.profile
log "✓ Perfect .profile created"

# ===== PHASE 2: NGINX CONFIG UPDATE FROM GIT =====
log "Phase 2: Update nginx routing from git config"
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
# Copy updated nginx config from git (already has Phase 0 auth setup)
sudo cp /opt/gmweb-startup/nginx-sites-enabled-default /etc/nginx/sites-available/default 2>/dev/null || true
# Reload nginx to pick up new config (non-blocking)
sudo nginx -s reload 2>/dev/null || true
log "✓ Nginx config updated from git"

# Ensure gmweb directory exists and has correct permissions
GMWEB_DIR="/config/.gmweb"
sudo mkdir -p "$GMWEB_DIR" && sudo chown -R abc:abc "$GMWEB_DIR" 2>/dev/null || true

log "Phase 1 complete - environment ready (using beforestart hook)"

log "Verifying persistent path structure..."
sudo mkdir -p /config/nvm /config/.tmp /config/logs /config/.local /config/.local/bin
sudo chown 1000:1000 /config/nvm /config/.tmp /config/logs /config/.local /config/.local/bin 2>/dev/null || true
sudo chmod 755 /config/nvm /config/.tmp /config/logs /config/.local /config/.local/bin 2>/dev/null || true

# Copy NVM compatibility shims to /config (shared across all shells and scripts)
cp /tmp/gmweb/startup/.nvm_compat.sh /config/.nvm_compat.sh
cp /tmp/gmweb/startup/.nvm_restore.sh /config/.nvm_restore.sh
chmod +x /config/.nvm_compat.sh /config/.nvm_restore.sh

NVM_DIR=/config/nvm
export NVM_DIR
log "Persistent paths ready: NVM_DIR=$NVM_DIR"

# Source beforestart hook to set up environment
log "Phase 1: Sourcing beforestart hook for environment setup..."
if [ -f /config/beforestart ]; then
  . /config/beforestart
else
  log "ERROR: beforestart hook not found at /config/beforestart"
  exit 1
fi

# ===== PHASE 2: NVM SETUP =====
# ALWAYS verify Node 24 and npm on every boot (persistent volumes can be corrupted)
mkdir -p "$NVM_DIR"

# Install NVM if not present
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  log "Installing NVM..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>&1 | tail -3
  # Re-source beforestart to load the newly installed NVM
  . /config/beforestart
fi

# ALWAYS guarantee clean npm/npx on every boot
# Persistent /config volume may have corrupted NVM node_modules
NODE_DIR="$NVM_DIR/versions/node"
LATEST_NODE=$(ls -1 "$NODE_DIR" 2>/dev/null | sort -V | tail -1)

if [ -z "$LATEST_NODE" ]; then
  log "No Node.js found, installing Node 24..."
  nvm install 24 2>&1 | tail -5
else
  NPM_MODULE="$NODE_DIR/$LATEST_NODE/lib/node_modules/npm"
  if [ ! -d "$NPM_MODULE" ]; then
    log "npm missing from $LATEST_NODE, reinstalling Node 24..."
    # Fix ownership first (may be root-owned from previous boot)
    chown -R abc:abc "$NODE_DIR/$LATEST_NODE" 2>/dev/null || true
    # Remove and reinstall to get clean npm
    nvm deactivate 2>/dev/null || true
    rm -rf "$NODE_DIR/$LATEST_NODE"
    nvm install 24 2>&1 | tail -5
  else
    log "Node $LATEST_NODE with npm verified"
  fi
fi

# Ensure node 24 is active and in PATH
nvm use 24 2>&1 | tail -2
nvm alias default 24 2>&1 | tail -2

# Fix ownership (nvm install as root creates root-owned files)
ACTIVE_NODE=$(nvm which current 2>/dev/null | sed 's|/bin/node||')
[ -d "$ACTIVE_NODE" ] && sudo chown -R abc:abc "$ACTIVE_NODE" 2>/dev/null || true

# Final verification
if ! command -v npm &>/dev/null; then
  log "ERROR: npm not available after nvm setup"
  log "DEBUG: PATH=$PATH"
  log "DEBUG: node=$(which node 2>&1)"
  exit 1
fi

NODE_VERSION=$(node -v | tr -d 'v')
NPM_VERSION=$(npm -v)
log "Node.js $NODE_VERSION, npm $NPM_VERSION (NVM_DIR=$NVM_DIR)"

# CRITICAL FIX: Clean and fix npm cache IMMEDIATELY after npm is available
log "CRITICAL: Fixing npm cache permissions (root-owned files from previous boots)..."
if [ -d "$GMWEB_DIR/npm-cache" ]; then
  # Force remove all cache to ensure clean state (corrupted cache causes cascading errors)
  sudo rm -rf "$GMWEB_DIR/npm-cache" 2>/dev/null || true
  mkdir -p "$GMWEB_DIR/npm-cache"
  chmod 777 "$GMWEB_DIR/npm-cache"
  log "  ✓ npm cache cleaned and recreated with proper permissions"
fi

# Also fix npm-global if it has permission issues
if [ -d "$GMWEB_DIR/npm-global" ]; then
  sudo chown -R abc:abc "$GMWEB_DIR/npm-global" 2>/dev/null || true
  sudo chmod -R u+rwX,g+rX,o-rwx "$GMWEB_DIR/npm-global" 2>/dev/null || true
  log "  ✓ npm-global permissions fixed"
fi

# Create npm wrapper if not already created
if [ ! -f /tmp/gmweb-wrappers/npm-as-abc.sh ]; then
  mkdir -p /tmp/gmweb-wrappers
  cat > /tmp/gmweb-wrappers/npm-as-abc.sh << 'NPM_WRAPPER_EOF'
#!/bin/bash
export NVM_DIR=/config/nvm
export HOME=/config
export GMWEB_DIR=/config/.gmweb
export npm_config_cache=/config/.gmweb/npm-cache
export npm_config_prefix=/config/.gmweb/npm-global
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="/config/.gmweb/npm-global/bin:$PATH"
if ! command -v npm &>/dev/null; then
  echo "ERROR: npm not available after NVM source" >&2
  echo "DEBUG: NVM_DIR=$NVM_DIR" >&2
  echo "DEBUG: PATH=$PATH" >&2
  exit 1
fi
exec "$@"
NPM_WRAPPER_EOF
  chmod +x /tmp/gmweb-wrappers/npm-as-abc.sh
fi

# Clear npm cache to prevent cascading permission errors
sudo -u abc /tmp/gmweb-wrappers/npm-as-abc.sh npm cache clean --force 2>&1 | tail -1 || true
log "✓ npm cache cleaned and fixed"

# ===== PHASE 3: SUPERVISOR SETUP =====
log "Setting up supervisor..."
rm -rf /tmp/gmweb /tmp/_keep_docker_scripts 2>/dev/null || true

# DEFENSIVE: One more npm cache clean right before critical supervisor install
log "Final npm cache verification before supervisor install..."
sudo -u abc /tmp/gmweb-wrappers/npm-as-abc.sh npm cache clean --force 2>&1 | tail -1 || true

# CRITICAL: Run supervisor npm install as abc user to prevent root cache contamination
log "Installing supervisor dependencies as abc user..."
cd /opt/gmweb-startup && \
  sudo -u abc /tmp/gmweb-wrappers/npm-as-abc.sh npm install --production --omit=dev 2>&1 | tail -3 && \
  chmod +x install.sh start.sh index.js && \
  chmod -R go+rx . && \
  chown -R root:root . && \
  chmod 755 .

sudo nginx -s reload 2>/dev/null || true
log "Supervisor ready (fresh from git)"

# ===== PHASE 4: XFCE LAUNCHER SCRIPT =====
cat > /tmp/launch_xfce_components.sh << 'XFCE_LAUNCHER_EOF'
#!/bin/bash
# XFCE Component Launcher for Oracle Kernel Compatibility
# Launches desktop components after XFCE session manager is ready

export DISPLAY=:1
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1000/bus"
export XDG_RUNTIME_DIR="/run/user/1000"
export HOME=/config

log() {
  echo "[xfce-launcher] $(date '+%Y-%m-%d %H:%M:%S') $@"
}

# Give XFCE session a moment to start (s6 manages it independently)
sleep 15

if ! pgrep -u abc xfce4-session >/dev/null 2>&1; then
  log "NOTE: XFCE session manager not running (desktop components skipped)"
  exit 0
fi

log "XFCE session detected, launching components..."
sleep 2  # Give session a moment to stabilize

log "Launching XFCE desktop components..."

# Panel (taskbar, clock, system tray)
if ! pgrep -u abc xfce4-panel >/dev/null 2>&1; then
  sudo -u abc HOME=/config DISPLAY=:1 DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
    XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" LD_PRELOAD=/opt/lib/libshim_close_range.so \
    xfce4-panel >/dev/null 2>&1 &
  log "xfce4-panel started (PID: $!)"
fi

# Desktop (wallpaper, icons)
if ! pgrep -u abc xfdesktop >/dev/null 2>&1; then
  sudo -u abc HOME=/config DISPLAY=:1 DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
    XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" LD_PRELOAD=/opt/lib/libshim_close_range.so \
    xfdesktop >/dev/null 2>&1 &
  log "xfdesktop started (PID: $!)"
fi

# Window Manager (borders, titles, Alt+Tab)
if ! pgrep -u abc xfwm4 >/dev/null 2>&1; then
  sudo -u abc HOME=/config DISPLAY=:1 DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
    XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" LD_PRELOAD=/opt/lib/libshim_close_range.so \
    xfwm4 >/dev/null 2>&1 &
  log "xfwm4 started (PID: $!)"
fi

log "XFCE component launcher complete"
XFCE_LAUNCHER_EOF

chmod +x /tmp/launch_xfce_components.sh
log "XFCE launcher script prepared"

# ===== PHASE 5: BACKGROUND INSTALLS =====
log "Phase 5: Spawning background installs (non-blocking - runs in parallel with services)..."

# CRITICAL: Background installs do NOT block supervisor or services
if [ -f /custom-cont-init.d/background-installs.sh ]; then
  nohup /custom-cont-init.d/background-installs.sh > "$LOG_DIR/background-installs.log" 2>&1 &
  log "✓ Background install process spawned (PID: $!)"
  log "  - All services are NOW ready to start"
  log "  - Background installs continue in parallel"
else
  log "WARNING: background-installs.sh not found at /custom-cont-init.d/"
fi

# ===== PHASE 6: START SUPERVISOR =====
log "Starting supervisor..."

unset NPM_CONFIG_PREFIX

if [ -f /opt/gmweb-startup/start.sh ]; then
  # CRITICAL: Pass essential environment variables to supervisor
  NVM_DIR=/config/nvm \
  HOME=/config \
  GMWEB_DIR="$GMWEB_DIR" \
  PATH="/config/.gmweb/cache/.bun/bin:/config/.gmweb/npm-global/bin:/config/.gmweb/tools/opencode/bin:$PATH" \
  NODE_OPTIONS="--no-warnings" \
  TMPDIR="/config/.tmp" \
  TMP="/config/.tmp" \
  TEMP="/config/.tmp" \
  XDG_RUNTIME_DIR="$RUNTIME_DIR" \
  XDG_CACHE_HOME="/config/.gmweb/cache" \
  XDG_CONFIG_HOME="/config/.gmweb/cache/.config" \
  XDG_DATA_HOME="/config/.gmweb/cache/.local/share" \
  DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME_DIR/bus" \
  DOCKER_CONFIG="/config/.gmweb/cache/.docker" \
  BUN_INSTALL="/config/.gmweb/cache/.bun" \
  PASSWORD="$PASSWORD" \
  sudo -E -u abc bash /opt/gmweb-startup/start.sh 2>&1 | tee -a "$LOG_DIR/startup.log" &
  SUPERVISOR_PID=$!
  sleep 2
  kill -0 $SUPERVISOR_PID 2>/dev/null && log "Supervisor started (PID: $SUPERVISOR_PID)" || log "WARNING: Supervisor may have failed"
else
  log "ERROR: start.sh not found at /opt/gmweb-startup/start.sh"
fi

# Launch XFCE components in background (after supervisor is running)
bash /tmp/launch_xfce_components.sh >> "$LOG_DIR/startup.log" 2>&1 &
log "XFCE component launcher started (PID: $!)"

# Optional: run any local startup.sh if it exists
[ -f "$HOME_DIR/startup.sh" ] && bash "$HOME_DIR/startup.sh" 2>&1 | tee -a "$LOG_DIR/startup.log"

log "===== REST OF STARTUP COMPLETE ====="
log "All services initialized in background"
log "nginx ready, supervisor running, services starting"
log "Background installs continue async (see /config/logs/background-installs.log)"
log "s6-rc services are now active (/desk/ endpoint available)"

exit 0
