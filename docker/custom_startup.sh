#!/bin/bash
set -e

# CRITICAL: Unset problematic environment variables immediately before anything else
unset LD_PRELOAD
unset NPM_CONFIG_PREFIX

HOME_DIR="/config"
LOG_DIR="$HOME_DIR/logs"

# Clear all logs on every boot - fresh start
rm -rf "$LOG_DIR" 2>/dev/null || true
mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR"
chown abc:abc "$LOG_DIR"

log() {
  echo "[gmweb-startup] $(date '+%Y-%m-%d %H:%M:%S') $@" | tee -a "$LOG_DIR/startup.log"
}

BOOT_ID="$(date '+%s')-$$"
log "===== GMWEB STARTUP (boot: $BOOT_ID) ====="

# CRITICAL: Configure nginx FIRST, before anything else
# This ensures /desk is accessible immediately
log "Phase 0: Configure nginx (FIRST - must be done before anything else)"
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

# Set up password for HTTP Basic Auth
if [ -z "${PASSWORD}" ]; then
  PASSWORD="password"
  log "WARNING: PASSWORD not set in environment, using fallback 'password'"
else
  log "✓ PASSWORD from environment (${#PASSWORD} chars)"
fi

# Generate hash and write htpasswd (always use /dev/stdin to safely handle special chars)
HASH=$(printf '%s' "$PASSWORD" | openssl passwd -apr1 -stdin 2>&1) || {
  log "ERROR: openssl passwd failed"
  exit 1
}

# Validate hash format (apr1 hash starts with $apr1$)
if [ -z "$HASH" ] || ! echo "$HASH" | grep -q '^\$apr1\$'; then
  log "ERROR: Invalid apr1 hash generated: $HASH"
  exit 1
fi

# Write htpasswd with validated hash
echo "abc:$HASH" | sudo tee /etc/nginx/.htpasswd > /dev/null
sudo chmod 644 /etc/nginx/.htpasswd

# Verify htpasswd was written correctly
if ! sudo grep -q '^abc:\$apr1\$' /etc/nginx/.htpasswd; then
  log "ERROR: htpasswd file is invalid or not properly written"
  exit 1
fi

sudo nginx -s reload 2>/dev/null || log "WARNING: nginx reload failed (nginx may not be running yet)"
export PASSWORD
log "✓ HTTP Basic Auth configured with valid apr1 hash"

# Clean up stale environment vars from persistent .profile
if [ -f "$HOME_DIR/.profile" ]; then
  grep -v -E "LD_PRELOAD|NPM_CONFIG_PREFIX" "$HOME_DIR/.profile" > "$HOME_DIR/.profile.tmp" && \
  mv "$HOME_DIR/.profile.tmp" "$HOME_DIR/.profile" || true
fi

# MIGRATION: Move legacy installations to centralized directory and clean pollution
# ALWAYS clean up and migrate on every boot (no markers - persistent volumes need verification)
log "Cleaning up legacy installations and ensuring clean state..."

# Create centralized directory
mkdir -p /config/.gmweb/{npm-cache,npm-global,tools,deps,cache}

# Migrate opencode if it exists in old location
if [ -d /config/.opencode ]; then
  log "  Moving /config/.opencode -> /config/.gmweb/tools/opencode"
  mv /config/.opencode /config/.gmweb/tools/opencode 2>/dev/null || true
fi

# Migrate old npm cache
if [ -d /config/.npm ]; then
  log "  Moving /config/.npm -> /config/.gmweb/npm-cache"
  mv /config/.npm/* /config/.gmweb/npm-cache/ 2>/dev/null || true
  rm -rf /config/.npm
fi

# Migrate generic cache directories to centralized location
for cache_dir in .cache .bun .docker .config; do
  if [ -d "/config/$cache_dir" ]; then
    log "  Moving /config/$cache_dir -> /config/.gmweb/cache/$cache_dir"
    mv "/config/$cache_dir" "/config/.gmweb/cache/$cache_dir" 2>/dev/null || true
  fi
done

# Clean up old installation/config directories (NOT user data like .claude, .agents)
sudo rm -rf /config/usr /config/.gmweb-deps /config/.gmweb-bashrc-setup /config/.gmweb-bashrc-setup-v2 /config/.gmweb-migrated-v2 2>/dev/null || true

# Clean up old Node versions that aren't v24 LTS
for node_dir in /config/nvm/versions/node/v*; do
  if [ -d "$node_dir" ] && [[ ! "$node_dir" =~ v24\. ]]; then
    log "  Removing old Node $(basename $node_dir)"
    rm -rf "$node_dir" 2>/dev/null || true
  fi
done

# Fix permissions on centralized directory
chown -R abc:abc /config/.gmweb 2>/dev/null || true
chmod -R 755 /config/.gmweb 2>/dev/null || true

# CRITICAL: Fix permissions on npm cache (in case root processes created files)
# This prevents EACCES errors when npm tries to write to cache
if [ -d /config/.gmweb/npm-cache ]; then
  chown -R abc:abc /config/.gmweb/npm-cache 2>/dev/null || true
  chmod -R 777 /config/.gmweb/npm-cache 2>/dev/null || true
  log "  Fixed npm cache permissions"
fi

log "✓ Cleanup complete - installations centralized to /config/.gmweb/"

# Compile close_range shim immediately (before anything else uses LD_PRELOAD)
mkdir -p /opt/lib

if [ ! -f /opt/lib/libshim_close_range.so ]; then
  log "Compiling close_range shim..."
  cat > /tmp/shim_close_range.c << 'SHIMEOF'
#define _GNU_SOURCE
#include <errno.h>

int close_range(unsigned int first, unsigned int last, int flags) {
    errno = 38;
    return -1;
}
SHIMEOF
  gcc -fPIC -shared /tmp/shim_close_range.c -o /opt/lib/libshim_close_range.so 2>&1 | grep -v "^$" || true
  rm -f /tmp/shim_close_range.c
  if [ ! -f /opt/lib/libshim_close_range.so ]; then
    log "ERROR: Failed to compile shim to /opt/lib/libshim_close_range.so"
    exit 1
  fi
  log "✓ Shim compiled to /opt/lib/libshim_close_range.so"
else
  log "✓ Shim already exists at /opt/lib/libshim_close_range.so"
fi

# NOTE: LD_PRELOAD only set for XFCE/desktop components below, not globally
# (Global LD_PRELOAD breaks shell pipes and command execution)

ABC_UID=$(id -u abc 2>/dev/null || echo 1000)
ABC_GID=$(id -g abc 2>/dev/null || echo 1000)
RUNTIME_DIR="/run/user/$ABC_UID"

# Create or fix permissions on runtime directory
if [ ! -d "$RUNTIME_DIR" ]; then
  # Try to create as current user first, fall back to sudo
  mkdir -p "$RUNTIME_DIR" 2>/dev/null || sudo mkdir -p "$RUNTIME_DIR" 2>/dev/null || true
  [ -d "$RUNTIME_DIR" ] && chmod 700 "$RUNTIME_DIR" 2>/dev/null || sudo chmod 700 "$RUNTIME_DIR" 2>/dev/null || true
  [ -d "$RUNTIME_DIR" ] && chown "$ABC_UID:$ABC_GID" "$RUNTIME_DIR" 2>/dev/null || sudo chown "$ABC_UID:$ABC_GID" "$RUNTIME_DIR" 2>/dev/null || true
fi

# Fix npm cache and stale installs from persistent volume
# Use sudo to handle any root-owned files from previous runs
log "Cleaning persistent volume artifacts..."
sudo rm -rf /config/.npm 2>/dev/null || true
sudo rm -rf /config/node_modules/.bin/* 2>/dev/null || true

# Clean existing npm cache if it exists (will be recreated in centralized location)
if command -v npm &>/dev/null; then
  npm cache clean --force 2>/dev/null || true
fi

# Create centralized directory for all gmweb tools and installations
# This keeps /config clean and user-friendly
GMWEB_DIR="/config/.gmweb"
mkdir -p "$GMWEB_DIR"/{npm-cache,npm-global,opencode,tools}
sudo chown -R abc:abc "$GMWEB_DIR" 2>/dev/null || true
sudo chmod -R 755 "$GMWEB_DIR" 2>/dev/null || true

# Configure npm to use centralized directory at ALL levels (black magic for bulletproof setup)

# 1. System-wide npmrc (/etc/npmrc) - read by all npm processes
cat > /tmp/npmrc << 'NPMRC_EOF'
cache=/config/.gmweb/npm-cache
prefix=/config/.gmweb/npm-global
NPMRC_EOF
sudo cp /tmp/npmrc /etc/npmrc 2>/dev/null || true

# 2. User-level npmrc (/config/.npmrc) - highest priority for user 'abc'
cat > /tmp/npmrc << 'NPMRC_EOF'
cache=/config/.gmweb/npm-cache
prefix=/config/.gmweb/npm-global
NPMRC_EOF
sudo cp /tmp/npmrc /config/.npmrc 2>/dev/null || true
sudo chown abc:abc /config/.npmrc 2>/dev/null || true
rm -f /tmp/npmrc

# 3. Environment variables - override everything, highest priority
export npm_config_cache="/config/.gmweb/npm-cache"
export npm_config_prefix="/config/.gmweb/npm-global"
export NPM_CONFIG_CACHE="/config/.gmweb/npm-cache"
export NPM_CONFIG_PREFIX="/config/.gmweb/npm-global"

# 4. Add npm global binaries to PATH
export PATH="/config/.gmweb/npm-global/bin:$PATH"

log "✓ Centralized gmweb directory configured at $GMWEB_DIR (system + user + env)"

export XDG_RUNTIME_DIR="$RUNTIME_DIR"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME_DIR/bus"

# Configure temp directory on same filesystem as config to avoid EXDEV errors
# (cross-device link errors when rename() is called across filesystems)
SAFE_TMPDIR="$HOME_DIR/.tmp"
mkdir -p "$SAFE_TMPDIR"
chmod 700 "$SAFE_TMPDIR"
chown abc:abc "$SAFE_TMPDIR"
export TMPDIR="$SAFE_TMPDIR"
export TMP="$SAFE_TMPDIR"
export TEMP="$SAFE_TMPDIR"
log "Configured temp directory: $TMPDIR (prevents cross-filesystem rename errors)"

# Prevent tools from polluting /config with cache/config directories
export XDG_CACHE_HOME="/config/.gmweb/cache"
export XDG_CONFIG_HOME="/config/.gmweb/cache/.config"
export XDG_DATA_HOME="/config/.gmweb/cache/.local/share"
export DOCKER_CONFIG="/config/.gmweb/cache/.docker"
export BUN_INSTALL="/config/.gmweb/cache/.bun"
mkdir -p "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$DOCKER_CONFIG" "$BUN_INSTALL"
log "Configured XDG directories to prevent /config pollution"

# Clean up old temp files (older than 7 days) to prevent unbounded growth
find "$SAFE_TMPDIR" -maxdepth 1 -type f -mtime +7 -delete 2>/dev/null || true
find "$SAFE_TMPDIR" -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \; 2>/dev/null || true

rm -f "$RUNTIME_DIR/bus"
pkill -u abc dbus-daemon 2>/dev/null || true

sudo -u abc DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
  dbus-daemon --session --address=unix:path=$RUNTIME_DIR/bus --print-address 2>/dev/null &
DBUS_DAEMON_PID=$!

for i in {1..10}; do
  if [ -S "$RUNTIME_DIR/bus" ]; then
    log "D-Bus session socket ready (attempt $i/10)"
    break
  fi
  sleep 0.5
done

if [ -S "$RUNTIME_DIR/bus" ]; then
  log "D-Bus session initialized"
else
  log "WARNING: D-Bus socket not ready"
fi

log "Phase 0.5: Install jq (required for JSON processing)"
if ! command -v jq &>/dev/null; then
  apt-get update -qq 2>/dev/null || true
  apt-get install -y --no-install-recommends jq 2>&1 | tail -3
  log "✓ jq installed"
else
  log "✓ jq already installed"
fi

# Ensure /config ownership is set to abc at the start
chown -R abc:abc /config 2>/dev/null || true
log "✓ /config ownership set to abc"

log "Phase 0: Kill all old gmweb processes from previous boots"
# CRITICAL: On persistent volumes, old processes keep running after container restart
# Kill all node processes running supervisor, services, or gmweb-related scripts
sudo pkill -f "node.*supervisor.js" 2>/dev/null || true
sudo pkill -f "node.*/opt/gmweb-startup" 2>/dev/null || true
sudo pkill -f "ttyd.*9999" 2>/dev/null || true
sudo fuser -k 9997/tcp 9998/tcp 9999/tcp 25808/tcp 2>/dev/null || true
sleep 2
log "✓ Old processes killed"

log "Phase 1: Git clone - get startup files and nginx config (minimal history)"
# CRITICAL: Use sudo to clean up root-owned files from previous boots (persistent volumes)
sudo rm -rf /tmp/gmweb /opt/gmweb-startup/node_modules /opt/gmweb-startup/lib \
       /opt/gmweb-startup/services /opt/gmweb-startup/package* \
       /opt/gmweb-startup/*.js /opt/gmweb-startup/*.json /opt/gmweb-startup/*.sh 2>/dev/null || true

sudo mkdir -p /opt/gmweb-startup

# Clone with minimal history and data - much faster
# --depth 1: no history
# --filter=blob:none: only get tree/commit objects, fetch blobs on demand (even smaller)
# --single-branch: only main branch
CLONE_RETRY=0
CLONE_MAX_RETRY=3
while [ $CLONE_RETRY -lt $CLONE_MAX_RETRY ]; do
  rm -rf /tmp/gmweb 2>/dev/null || true
  if timeout 120 git clone --depth 1 --filter=blob:none --single-branch --branch main \
    https://github.com/AnEntrypoint/gmweb.git /tmp/gmweb 2>&1 | tail -3; then
    if [ -d /tmp/gmweb/startup ]; then
      log "✓ Git clone succeeded (attempt $((CLONE_RETRY + 1))/$CLONE_MAX_RETRY)"
      break
    fi
  fi
  CLONE_RETRY=$((CLONE_RETRY + 1))
  if [ $CLONE_RETRY -lt $CLONE_MAX_RETRY ]; then
    log "WARNING: Git clone failed, retrying (attempt $((CLONE_RETRY + 1))/$CLONE_MAX_RETRY)..."
    sleep $((CLONE_RETRY * 5))
  fi
done

if [ ! -d /tmp/gmweb/startup ]; then
  log "ERROR: Git clone failed after $CLONE_MAX_RETRY attempts, startup files missing"
  exit 1
fi

cp -r /tmp/gmweb/startup/* /opt/gmweb-startup/
cp /tmp/gmweb/docker/nginx-sites-enabled-default /opt/gmweb-startup/
log "✓ Startup files copied to /opt/gmweb-startup"

log "Phase 2: Update nginx routing from git config"
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
# Copy updated nginx config from git (already has Phase 0 auth setup)
sudo cp /opt/gmweb-startup/nginx-sites-enabled-default /etc/nginx/sites-available/default 2>/dev/null || true
# Reload nginx to pick up new config (non-blocking)
sudo nginx -s reload 2>/dev/null || true
log "✓ Nginx config updated from git"

# Ensure gmweb directory exists and has correct permissions
mkdir -p "$GMWEB_DIR" && chown -R abc:abc "$GMWEB_DIR" 2>/dev/null || true

# ALWAYS regenerate .profile on every boot (no markers - persistent volumes need verification)
cat > "$HOME_DIR/.profile" << 'PROFILE_EOF'
export TMPDIR="${HOME}/.tmp"
export TMP="${HOME}/.tmp"
export TEMP="${HOME}/.tmp"
mkdir -p "${TMPDIR}" 2>/dev/null || true

export NVM_DIR="/config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Force npm to use centralized cache (prevents /config pollution)
export npm_config_cache="/config/.gmweb/npm-cache"
export npm_config_prefix="/config/.gmweb/npm-global"
export NPM_CONFIG_CACHE="/config/.gmweb/npm-cache"
export NPM_CONFIG_PREFIX="/config/.gmweb/npm-global"
PROFILE_EOF
log "✓ .profile configured"

# ALWAYS regenerate .bashrc on every boot (no markers - persistent volumes need verification)
# Clean existing bashrc from any gmweb entries first
if [ -f "$HOME_DIR/.bashrc" ]; then
  grep -v -E "NVM_DIR|nvm.sh|bash_completion|gmweb|opencode" "$HOME_DIR/.bashrc" > "$HOME_DIR/.bashrc.tmp" && \
  mv "$HOME_DIR/.bashrc.tmp" "$HOME_DIR/.bashrc" || true
fi

# Add fresh setup with centralized paths
cat >> "$HOME_DIR/.bashrc" << 'EOF'

# gmweb NVM setup - ensures Node.js is available in non-login shells
export NVM_DIR="/config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
# nvm bash completion (optional)
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"

# gmweb tools - centralized directory (/config/.gmweb keeps root clean)
export PATH="/config/.gmweb/npm-global/bin:/config/.gmweb/tools/opencode/bin:$PATH"

# Force npm to use centralized cache (prevents /config pollution)
export npm_config_cache="/config/.gmweb/npm-cache"
export npm_config_prefix="/config/.gmweb/npm-global"
export NPM_CONFIG_CACHE="/config/.gmweb/npm-cache"
export NPM_CONFIG_PREFIX="/config/.gmweb/npm-global"
EOF
log "✓ .bashrc configured with centralized paths"

log "Phase 1 complete"

log "Verifying persistent path structure..."
mkdir -p /config/nvm /config/.tmp /config/logs
chmod 755 /config/nvm /config/.tmp /config/logs 2>/dev/null || true

NVM_DIR=/config/nvm
export NVM_DIR
log "Persistent paths ready: NVM_DIR=$NVM_DIR"

# CRITICAL: NVM is incompatible with NPM_CONFIG_PREFIX and .npmrc prefix setting
# Temporarily unset env vars AND rename .npmrc, then restore after NVM setup
_NPM_CONFIG_CACHE="$NPM_CONFIG_CACHE"
_NPM_CONFIG_PREFIX="$NPM_CONFIG_PREFIX"
_npm_config_cache="$npm_config_cache"
_npm_config_prefix="$npm_config_prefix"
unset NPM_CONFIG_PREFIX npm_config_prefix NPM_CONFIG_CACHE npm_config_cache

# Temporarily hide .npmrc from NVM
if [ -f /config/.npmrc ]; then
  mv /config/.npmrc /config/.npmrc.nvmbackup 2>/dev/null || true
fi

# Always source NVM if available
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# ALWAYS verify Node 24 and npm on every boot (persistent volumes can be corrupted)
mkdir -p "$NVM_DIR"

# Install NVM if not present
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  log "Installing NVM..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>&1 | tail -3
  . "$NVM_DIR/nvm.sh"
fi

# Check if Node 24 exists and npm is working
if ! command -v node &>/dev/null || ! node -v | grep -q "^v24\." || ! command -v npm &>/dev/null; then
  # Node or npm missing/broken - reinstall
  log "Installing/repairing Node.js 24 (LTS) with npm..."
  nvm install 24 --reinstall-packages-from=24 2>&1 | tail -5
  nvm alias default 24 2>&1 | tail -2
  nvm alias stable 24 2>&1 | tail -2
  nvm use 24 2>&1 | tail -2
  
  # Verify npm is installed, fallback to manual install
  if ! command -v npm &>/dev/null; then
    log "WARNING: npm not found after nvm install, installing manually..."
    curl -qL https://www.npmjs.com/install.sh | sh 2>&1 | tail -3
  fi
  
  log "✓ Node.js 24 (LTS) installed with npm $(npm -v 2>/dev/null || echo 'ERROR')"
else
  # Node 24 and npm exist - ensure they're active
  nvm use 24 2>&1 | tail -2 || true
  nvm alias default 24 2>&1 | tail -2 || true
  nvm alias stable 24 2>&1 | tail -2 || true
  log "✓ Node.js 24 (LTS) verified with npm $(npm -v 2>/dev/null || echo 'ERROR')"
fi

# Final verification - fail hard if npm still missing
if ! command -v npm &>/dev/null; then
  log "ERROR: npm still not available after installation attempts"
  exit 1
fi

# Restore npm config vars and .npmrc that we hid for NVM compatibility
export NPM_CONFIG_CACHE="$_NPM_CONFIG_CACHE"
export NPM_CONFIG_PREFIX="$_NPM_CONFIG_PREFIX"
export npm_config_cache="$_npm_config_cache"
export npm_config_prefix="$_npm_config_prefix"

# Restore .npmrc
if [ -f /config/.npmrc.nvmbackup ]; then
  mv /config/.npmrc.nvmbackup /config/.npmrc 2>/dev/null || true
fi

NODE_VERSION=$(node -v | tr -d 'v')
NPM_VERSION=$(npm -v)
log "Node.js $NODE_VERSION, npm $NPM_VERSION (NVM_DIR=$NVM_DIR)"

log "Setting up supervisor..."
# Clean up temp clone dir
rm -rf /tmp/gmweb /tmp/_keep_docker_scripts 2>/dev/null || true

cd /opt/gmweb-startup && \
  npm install --production --omit=dev 2>&1 | tail -3 && \
  chmod +x install.sh start.sh index.js && \
  chmod -R go+rx . && \
  chown -R root:root . && \
  chmod 755 .

nginx -s reload 2>/dev/null || true
log "Supervisor ready (fresh from git)"

if [ ! -f /usr/bin/ttyd ]; then
  log "Installing ttyd for webssh2..."
  # Use apt-get for reliable, compatible binaries across all architectures
  sudo apt-get update -qq 2>/dev/null && \
  sudo apt-get install -y ttyd 2>/dev/null && \
  log "✓ ttyd installed from apt-get" || \
  log "WARNING: ttyd installation failed - webssh2 will be unavailable"
fi

cat > /tmp/launch_xfce_components.sh << 'XFCE_LAUNCHER_EOF'
#!/bin/bash
# XFCE Component Launcher for Oracle Kernel Compatibility
# Launches desktop components after XFCE session manager is ready
# This works around Oracle kernel D-Bus compatibility issues

export DISPLAY=:1
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1000/bus"
export XDG_RUNTIME_DIR="/run/user/1000"
export HOME=/config

log() {
  echo "[xfce-launcher] $(date '+%Y-%m-%d %H:%M:%S') $@" | tee -a "$HOME/logs/startup.log"
}

# Wait for XFCE session manager to start (max 30 seconds)
for i in {1..30}; do
  if pgrep -u abc xfce4-session >/dev/null 2>&1; then
    log "XFCE session detected (attempt $i/30)"
    sleep 2  # Give session a moment to stabilize
    break
  fi
  sleep 1
done

if ! pgrep -u abc xfce4-session >/dev/null 2>&1; then
  log "WARNING: XFCE session manager not detected after 30s, skipping component launch"
  exit 0
fi

# Launch XFCE components (they may already be running, that's OK)
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

log "Installing critical Node modules for AionUI..."
mkdir -p "$GMWEB_DIR/deps"

# Install with timeout - fail hard if anything goes wrong
timeout 30 npm install -g better-sqlite3 2>&1 | tail -2 || {
  log "ERROR: better-sqlite3 installation failed"
  exit 1
}

cd "$GMWEB_DIR/deps" && timeout 30 npm install bcrypt 2>&1 | tail -2 || {
  log "ERROR: bcrypt installation failed"
  exit 1
}

chown -R abc:abc "$GMWEB_DIR/deps" 2>/dev/null || true
log "✓ Critical modules installed"

log "Starting supervisor..."
if [ -f /opt/gmweb-startup/start.sh ]; then
  # CRITICAL: Pass ALL environment variables to supervisor so all services share the same environment
  # This ensures no service has settings that others don't have
  NVM_DIR=/config/nvm \
  HOME=/config \
  GMWEB_DIR="$GMWEB_DIR" \
  PATH="/config/.gmweb/npm-global/bin:/config/.gmweb/tools/opencode/bin:$PATH" \
  NODE_OPTIONS="--no-warnings" \
  npm_config_cache="/config/.gmweb/npm-cache" \
  npm_config_prefix="/config/.gmweb/npm-global" \
  NPM_CONFIG_CACHE="/config/.gmweb/npm-cache" \
  NPM_CONFIG_PREFIX="/config/.gmweb/npm-global" \
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
  sudo -u abc -E bash /opt/gmweb-startup/start.sh 2>&1 | tee -a "$LOG_DIR/startup.log" &
  SUPERVISOR_PID=$!
  sleep 2
  kill -0 $SUPERVISOR_PID 2>/dev/null && log "Supervisor started (PID: $SUPERVISOR_PID)" || log "WARNING: Supervisor may have failed"
else
  log "ERROR: start.sh not found"
  exit 1
fi

# Launch XFCE components in background (after supervisor is running)
bash /tmp/launch_xfce_components.sh >> "$LOG_DIR/startup.log" 2>&1 &
log "XFCE component launcher started (PID: $!)"

{
  # CRITICAL: Source NVM in subshell so npm/node commands work
  export NVM_DIR=/config/nvm
  export HOME=/config
  export GMWEB_DIR=/config/.gmweb
  # Force npm to use centralized cache
  export npm_config_cache="/config/.gmweb/npm-cache"
  export npm_config_prefix="/config/.gmweb/npm-global"
  export NPM_CONFIG_CACHE="/config/.gmweb/npm-cache"
  export NPM_CONFIG_PREFIX="/config/.gmweb/npm-global"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  
  # Install base packages
  apt-get update
  apt-get install -y --no-install-recommends git curl lsof sudo 2>&1 | tail -3

  # Install GitHub CLI (gh) from official repository
  log "Installing GitHub CLI..."
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null

  # Install Google Cloud CLI (gcloud) from official repository
  log "Installing Google Cloud CLI..."
  echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list > /dev/null
  curl https://packages.cloud.google.com/apt/doc/apt-key.gpg 2>/dev/null | sudo apt-key --keyring /usr/share/keyrings/cloud.google.gpg add - 2>/dev/null || true

  # Update package lists and install gh + gcloud
  sudo apt-get update -qq 2>/dev/null || true
  sudo apt-get install -y --no-install-recommends gh google-cloud-cli 2>&1 | tail -3 || log "WARNING: gh or gcloud install had issues"

  bash /opt/gmweb-startup/install.sh 2>&1 | tail -10
  log "Background installations complete"

  log "Installing CLI coding tools (opencode)..."
  # Install opencode to centralized directory
  export OPENCODE_INSTALL_DIR="$GMWEB_DIR/tools"
  if ! command -v opencode &>/dev/null; then
    mkdir -p "$OPENCODE_INSTALL_DIR"
    curl -fsSL https://opencode.ai/install | bash 2>&1 | tail -5 && log "opencode installed" || log "WARNING: opencode install failed"
  else
    log "opencode already installed"
  fi
  log "CLI coding tools installation complete"

  log "Installing cloud and deployment tools (wrangler)..."
  npm install -g wrangler 2>&1 | tail -3 && log "wrangler installed" || log "WARNING: wrangler install failed"
  log "Cloud and deployment tools installation complete"

  touch /tmp/gmweb-installs-complete
  log "Installation marker file created"
} >> "$LOG_DIR/startup.log" 2>&1 &
log "Background installs started (PID: $!)"

[ -f "$HOME_DIR/startup.sh" ] && bash "$HOME_DIR/startup.sh" 2>&1 | tee -a "$LOG_DIR/startup.log"

# Final ownership pass - ensure all files are owned by abc
chown -R abc:abc "$HOME_DIR" 2>/dev/null || true
log "✓ Final /config ownership set to abc"

# Set working directory to /config for any subsequent processes
cd /config
log "✓ Working directory set to /config"

log "===== GMWEB STARTUP COMPLETE ====="
exit 0
