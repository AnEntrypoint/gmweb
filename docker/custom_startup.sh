#!/bin/bash
# CRITICAL: Do NOT use 'set -e' - allows startup to continue even if critical module install fails
# Supervisor will retry failed services via health checks
set +e

# Force redeploy: Ensures latest glootie-oc package with fixed opencode.json
# CRITICAL: Unset problematic environment variables immediately before anything else
unset LD_PRELOAD
unset NPM_CONFIG_PREFIX

HOME_DIR="/config"

# CRITICAL: Set ownership to abc:abc (UID 1000) at startup start
# Use sudo to ensure proper privilege elevation for permission operations
# This is the FIRST thing to ensure all subsequent operations create abc-owned files
sudo chown -R 1000:1000 "/config" 2>/dev/null || true
sudo chmod -R u+rwX,g+rX,o-rwx "/config" 2>/dev/null || true
LOG_DIR="$HOME_DIR/logs"

# Clear all logs on every boot - fresh start
sudo rm -rf "$LOG_DIR" 2>/dev/null || true
sudo mkdir -p "$LOG_DIR"
sudo chmod 755 "$LOG_DIR"
sudo chown 1000:1000 "$LOG_DIR"

log() {
  local msg="[gmweb-startup] $(date '+%Y-%m-%d %H:%M:%S') $@"
  echo "$msg"
  echo "$msg" >> "$LOG_DIR/startup.log"
  # CRITICAL: Flush to disk immediately - prevents log loss if script exits unexpectedly
  # Direct file append avoids pipe buffering issues with tee
  sync "$LOG_DIR/startup.log" 2>/dev/null || true
}

# CRITICAL: Create npm wrapper script for abc user
# This ensures ALL npm operations run as abc, preventing root-owned files
mkdir -p /tmp/gmweb-wrappers
cat > /tmp/gmweb-wrappers/npm-as-abc.sh << 'NPM_WRAPPER_EOF'
#!/bin/bash
export NVM_DIR=/config/nvm
export HOME=/config
export GMWEB_DIR=/config/.gmweb
export npm_config_cache=/config/.gmweb/npm-cache
export npm_config_prefix=/config/.gmweb/npm-global
# Source NVM FIRST to get node/npm in PATH
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
# THEN add npm-global to PATH (after NVM's PATH updates)
export PATH="/config/.gmweb/npm-global/bin:$PATH"
# CRITICAL: Verify npm exists before running command
if ! command -v npm &>/dev/null; then
  echo "ERROR: npm not available after NVM source" >&2
  echo "DEBUG: NVM_DIR=$NVM_DIR" >&2
  echo "DEBUG: PATH=$PATH" >&2
  exit 1
fi
exec "$@"
NPM_WRAPPER_EOF
chmod +x /tmp/gmweb-wrappers/npm-as-abc.sh

# Log the initial ownership fix (now that log function exists)
log "CRITICAL: Initial /config ownership and permissions fixed (Phase 0 startup)"

# CRITICAL PHASE 0.5: Comprehensive Permission Management
# Ensure ALL critical home directory paths are created and owned by abc:abc
# This prevents permission cascades where services fail to write to their own directories
log "Phase 0.5: Comprehensive home directory permission setup"

# Define all critical paths that abc user needs access to
CRITICAL_PATHS=(
  "$HOME_DIR"
  "$HOME_DIR/.config"
  "$HOME_DIR/.local"
  "$HOME_DIR/.local/bin"
  "$HOME_DIR/.local/share"
  "$HOME_DIR/.local/share/opencode"
  "$HOME_DIR/.local/share/opencode/storage"
  "$HOME_DIR/.cache"
  "$HOME_DIR/.gmweb"
  "$HOME_DIR/.gmweb/tools"
  "$HOME_DIR/.gmweb/cache"
  "$HOME_DIR/.gmweb/npm-cache"
  "$HOME_DIR/.gmweb/npm-global"
  "$HOME_DIR/.gmweb/npm-global/bin"
  "$HOME_DIR/.gmweb/npm-global/lib"
  "$HOME_DIR/.tmp"
  "$HOME_DIR/logs"
  "$HOME_DIR/workspace"
  "$HOME_DIR/.nvm"
  "/run/user/1000"
)

# Create all critical paths with correct permissions
for path in "${CRITICAL_PATHS[@]}"; do
  if [ ! -d "$path" ]; then
    sudo mkdir -p "$path" 2>/dev/null || true
    log "Created directory: $path"
  fi
  # Fix ownership: ensure abc:abc owns everything
  sudo chown 1000:1000 "$path" 2>/dev/null || true
  # Fix permissions: directories should be rwx for owner, rx for group/others (755)
  # But .cache, .tmp, .config should be more restrictive (700-750)
  if [[ "$path" =~ (.cache|.tmp|.config|workspace) ]]; then
    sudo chmod 750 "$path" 2>/dev/null || true
  else
    sudo chmod 755 "$path" 2>/dev/null || true
  fi
done

# Recursively fix permissions on critical directories (important for stale volumes)
log "Fixing permissions on critical directory trees..."
# CRITICAL: Use -maxdepth and avoid cache which can be huge (2.5GB+)
# -cache is cleared below, so no need to fix its permissions
for dir in "$HOME_DIR/.config" "$HOME_DIR/.local" "$HOME_DIR/.gmweb"; do
  if [ -d "$dir" ]; then
    # Use -maxdepth 3 to avoid going too deep into large directory trees
    # This prevents the find command from getting stuck on massive caches
    timeout 30 sudo find "$dir" -maxdepth 3 -type d -exec chown 1000:1000 {} \; 2>/dev/null || true
    timeout 30 sudo find "$dir" -maxdepth 3 -type d -exec chmod 755 {} \; 2>/dev/null || true
    # Fix files: ensure they're readable and writable by owner
    timeout 30 sudo find "$dir" -maxdepth 3 -type f -exec chown 1000:1000 {} \; 2>/dev/null || true
    timeout 30 sudo find "$dir" -maxdepth 3 -type f -exec chmod 644 {} \; 2>/dev/null || true
  fi
done
# Cache is cleared separately below, no need to fix its permissions

log "✓ Comprehensive permission setup complete (all paths now abc:abc owned)"

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

# CRITICAL: Install nginx binary BEFORE attempting to start it
# nginx-common is in base image but nginx binary itself is not installed
log "Installing nginx binary package"
apt-get update -qq 2>/dev/null || true
apt-get install -y --no-install-recommends nginx 2>&1 | tail -2 || {
  log "ERROR: Failed to install nginx"
  exit 1
}

# Verify nginx binary is now available
if ! which nginx > /dev/null 2>&1; then
  log "ERROR: nginx binary not found after installation"
  exit 1
fi
log "✓ nginx binary installed"

# Start nginx immediately (it may not be running from s6 yet)
sudo nginx 2>/dev/null || sudo nginx -s reload 2>/dev/null || log "WARNING: nginx start/reload failed"
sleep 1
# Verify nginx is listening
if netstat -tuln 2>/dev/null | grep -q ":80 " || lsof -i :80 2>/dev/null | grep -q nginx; then
  log "✓ nginx listening on port 80"
else
  log "WARNING: nginx may not be listening yet (will retry)"
fi
export PASSWORD
log "✓ HTTP Basic Auth configured and nginx started"

# CRITICAL PHASE 0-apt: Consolidated APT installations
# ALL system packages installed at once before anything else
# This is BLOCKING and required before Bun installation
log "Phase 0-apt: Consolidated system package installation (BLOCKING - required for Bun and services)"
apt-get update -qq 2>/dev/null || true

# Install all packages together: core tools + ttyd + gh + gcloud dependencies
log "  Installing: unzip jq ttyd"
apt-get install -y --no-install-recommends unzip jq ttyd 2>&1 | tail -2
log "  ✓ Core packages installed (unzip, jq, ttyd)"

# Add and install GitHub CLI (gh)
log "  Adding GitHub CLI repository and installing gh"
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg 2>/dev/null | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null || true
echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null 2>/dev/null || true
apt-get update -qq 2>/dev/null || true
apt-get install -y gh 2>&1 | tail -2
log "  ✓ GitHub CLI (gh) installed"

# Add and install Google Cloud CLI (gcloud)
log "  Adding Google Cloud repository and installing gcloud"
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list > /dev/null 2>/dev/null || true
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg 2>/dev/null | sudo apt-key --keyring /usr/share/keyrings/cloud.google.gpg add - 2>/dev/null || true
apt-get update -qq 2>/dev/null || true
apt-get install -y google-cloud-cli 2>&1 | tail -2
log "  ✓ Google Cloud CLI (gcloud) installed"

log "✓ Phase 0-apt complete - all system packages installed (unzip, jq, ttyd, gh, gcloud)"

# APT installation is now complete and blocking is done
# Proceed with remaining setup

# Note: .bashrc and .profile are no longer used - environment is set via beforestart hook

# MIGRATION: Move legacy installations to centralized directory and clean pollution
# ALWAYS clean up and migrate on every boot (no markers - persistent volumes need verification)
log "Cleaning up legacy installations and ensuring clean state..."

# Create centralized directory with proper ownership
mkdir -p /config/.gmweb/{npm-cache,npm-global,tools,deps,cache}
chown -R 1000:1000 /config/.gmweb 2>/dev/null || true
chmod -R u+rwX,g+rX,o-rwx /config/.gmweb 2>/dev/null || true

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
  # Use sudo for aggressive cleanup if needed
  sudo chown -R abc:abc /config/.gmweb/npm-cache 2>/dev/null || true
  sudo chmod -R 777 /config/.gmweb/npm-cache 2>/dev/null || true
  # Also clean npm cache completely (may be corrupted from previous boots)
  sudo rm -rf /config/.gmweb/npm-cache/* 2>/dev/null || true
  mkdir -p /config/.gmweb/npm-cache
  chown abc:abc /config/.gmweb/npm-cache
  chmod 777 /config/.gmweb/npm-cache
  log "  Cleaned and fixed npm cache permissions"
fi

log "✓ Cleanup complete - installations centralized to /config/.gmweb/"

# Compile close_range shim immediately (before anything else uses LD_PRELOAD)
sudo mkdir -p /opt/lib

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
  gcc -fPIC -shared /tmp/shim_close_range.c -o /tmp/libshim_close_range.so 2>&1 | grep -v "^$" || true
  rm -f /tmp/shim_close_range.c
  if [ ! -f /tmp/libshim_close_range.so ]; then
    log "ERROR: Failed to compile shim to /tmp/libshim_close_range.so"
    exit 1
  fi
  # Use sudo to move to /opt/lib
  sudo mv /tmp/libshim_close_range.so /opt/lib/libshim_close_range.so
  sudo chmod 755 /opt/lib/libshim_close_range.so
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
  # Use sudo for all runtime directory creation operations
  sudo mkdir -p "$RUNTIME_DIR" 2>/dev/null || true
  sudo chmod 700 "$RUNTIME_DIR" 2>/dev/null || true
  sudo chown "$ABC_UID:$ABC_GID" "$RUNTIME_DIR" 2>/dev/null || true
fi

# Fix npm cache and stale installs from persistent volume
# Use sudo to handle any root-owned files from previous runs
log "Cleaning persistent volume artifacts..."
sudo rm -rf /config/.npm 2>/dev/null || true
sudo rm -rf /config/node_modules/.bin/* 2>/dev/null || true

# Clean existing npm cache if it exists (will be recreated in centralized location)
# CRITICAL: Run as abc user to prevent root cache contamination
if command -v npm &>/dev/null; then
  sudo -u abc /tmp/gmweb-wrappers/npm-as-abc.sh npm cache clean --force 2>/dev/null || true
fi

# Create centralized directory for all gmweb tools and installations
# This keeps /config clean and user-friendly
GMWEB_DIR="/config/.gmweb"
sudo mkdir -p "$GMWEB_DIR"/{npm-cache,npm-global,opencode,tools}
sudo chown -R 1000:1000 "$GMWEB_DIR" 2>/dev/null || true
sudo chmod -R u+rwX,g+rX,o-rwx "$GMWEB_DIR" 2>/dev/null || true

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

# 3. CRITICAL: Do NOT set npm_config_prefix/NPM_CONFIG_PREFIX as env vars
# This interferes with NVM which refuses to load when these are set
# npm will read config from .npmrc files instead (already configured above)
# Only the npm wrapper will set these when needed, after NVM is sourced

# 4. Add npm global binaries to PATH (NVM will add node bins later)
export PATH="/config/.gmweb/npm-global/bin:$PATH"

log "✓ Centralized gmweb directory configured at $GMWEB_DIR (system + user + env)"

# EARLY FIX: Clear npm cache early (before NVM is even set up)
# Root-owned files from previous boots cause EACCES cascades later
# We DELETE and recreate to ensure fresh clean state
log "Phase 0.75: Pre-clearing npm cache directories (prevents root-owned file cascade)..."
if [ -d "$GMWEB_DIR/npm-cache" ]; then
  sudo rm -rf "$GMWEB_DIR/npm-cache" 2>/dev/null || true
  mkdir -p "$GMWEB_DIR/npm-cache"
  chmod 777 "$GMWEB_DIR/npm-cache"
  log "  ✓ npm-cache pre-cleared and recreated with 777 permissions"
fi

if [ -d "$GMWEB_DIR/npm-global" ]; then
  sudo rm -rf "$GMWEB_DIR/npm-global" 2>/dev/null || true
  mkdir -p "$GMWEB_DIR/npm-global"
  chmod 777 "$GMWEB_DIR/npm-global"
  log "  ✓ npm-global pre-cleared and recreated with 777 permissions"
fi

export XDG_RUNTIME_DIR="$RUNTIME_DIR"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME_DIR/bus"

# Configure temp directory on same filesystem as config to avoid EXDEV errors
# (cross-device link errors when rename() is called across filesystems)
SAFE_TMPDIR="$HOME_DIR/.tmp"
sudo mkdir -p "$SAFE_TMPDIR"
sudo chmod 700 "$SAFE_TMPDIR"
sudo chown abc:abc "$SAFE_TMPDIR"
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
sudo mkdir -p "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$DOCKER_CONFIG" "$BUN_INSTALL"
log "Configured XDG directories to prevent /config pollution"

# beforestart hook will be copied after git clone and used as source of truth for environment setup

# Clean up old temp files (older than 7 days) to prevent unbounded growth
sudo find "$SAFE_TMPDIR" -maxdepth 1 -type f -mtime +7 -delete 2>/dev/null || true
sudo find "$SAFE_TMPDIR" -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \; 2>/dev/null || true

sudo rm -f "$RUNTIME_DIR/bus"
sudo pkill -u abc dbus-daemon 2>/dev/null || true

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

# jq and unzip already installed in Phase 0-early (BLOCKING phase before Bun installation)

# Verify /config ownership is set to abc:abc (UID 1000:GID 1000)
# (This should already be done above, but verify again as safety check)
sudo chown -R 1000:1000 /config 2>/dev/null || true
sudo chmod -R u+rwX,g+rX,o-rwx /config 2>/dev/null || true
log "✓ /config ownership verified as abc:abc (UID:GID 1000:1000)"

# Every boot is fresh - redeploy means new container, no old processes to kill
if sudo lsof -i :9997 :9998 :9999 :25808 :8317 :8082 2>/dev/null | grep -q LISTEN; then
  log "WARNING: Some ports still in use, waiting additional 2s..."
  sleep 2
fi
log "✓ Old processes killed and ports cleared"

log "Phase 1: Git clone - get startup files and nginx config (minimal history)"
# CRITICAL: Use sudo to clean up root-owned files from previous boots (persistent volumes)
sudo rm -rf /tmp/gmweb /opt/gmweb-startup/node_modules /opt/gmweb-startup/lib \
       /opt/gmweb-startup/services /opt/gmweb-startup/package* \
       /opt/gmweb-startup/*.js /opt/gmweb-startup/*.json /opt/gmweb-startup/*.sh \
       /opt/gmweb-startup/.git 2>/dev/null || true

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

# Copy beforestart and beforeend hooks to /config/
log "Phase 1.0a: Setting up beforestart and beforeend hooks..."
cp /tmp/gmweb/startup/beforestart /config/beforestart
cp /tmp/gmweb/startup/beforeend /config/beforeend
chmod +x /config/beforestart /config/beforeend
chown abc:abc /config/beforestart /config/beforeend
log "✓ beforestart and beforeend hooks installed to /config/"

# Generate perfect .bashrc file that sources beforestart hook
# This ensures all interactive shells have consistent environment
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

# Generate perfect .profile file that sources beforestart hook
# This ensures all login shells have consistent environment
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

log "Phase 2: Update nginx routing from git config"
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
# Copy updated nginx config from git (already has Phase 0 auth setup)
sudo cp /opt/gmweb-startup/nginx-sites-enabled-default /etc/nginx/sites-available/default 2>/dev/null || true
# Reload nginx to pick up new config (non-blocking)
sudo nginx -s reload 2>/dev/null || true
log "✓ Nginx config updated from git"

# Ensure gmweb directory exists and has correct permissions
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
# Strategy: check if npm module exists, if not do a clean reinstall
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
# This prevents EACCES errors when npm tries to write to cache owned by root
log "CRITICAL: Fixing npm cache permissions (root-owned files from previous boots)..."
if [ -d "/config/.gmweb/npm-cache" ]; then
  # Force remove all cache to ensure clean state (corrupted cache causes cascading errors)
  sudo rm -rf /config/.gmweb/npm-cache 2>/dev/null || true
  mkdir -p /config/.gmweb/npm-cache
  chmod 777 /config/.gmweb/npm-cache
  log "  ✓ npm cache cleaned and recreated with proper permissions"
fi

# Also fix npm-global if it has permission issues
if [ -d "/config/.gmweb/npm-global" ]; then
  sudo chown -R abc:abc /config/.gmweb/npm-global 2>/dev/null || true
  sudo chmod -R u+rwX,g+rX,o-rwx /config/.gmweb/npm-global 2>/dev/null || true
  log "  ✓ npm-global permissions fixed"
fi

# Clear npm cache to prevent cascading permission errors
# CRITICAL: Run as abc user to prevent root contamination
sudo -u abc /tmp/gmweb-wrappers/npm-as-abc.sh npm cache clean --force 2>&1 | tail -1 || true
log "✓ npm cache cleaned and fixed"

log "Setting up supervisor..."
# Clean up temp clone dir
rm -rf /tmp/gmweb /tmp/_keep_docker_scripts 2>/dev/null || true

# DEFENSIVE: One more npm cache clean right before critical supervisor install
# This catches any permission issues that may have crept in
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

nginx -s reload 2>/dev/null || true
log "Supervisor ready (fresh from git)"

# ttyd installation moved to background phase (runs right after nginx is ready)

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
  # Direct echo (background process group handles file redirection)
  echo "[xfce-launcher] $(date '+%Y-%m-%d %H:%M:%S') $@"
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

log "Installing critical Node modules for AionUI (background - supervisor will retry)..."
sudo mkdir -p "$GMWEB_DIR/deps"
sudo chown 1000:1000 "$GMWEB_DIR/deps" 2>/dev/null || true
sudo chmod u+rwX,g+rX,o-rwx "$GMWEB_DIR/deps" 2>/dev/null || true

# CRITICAL: These native module installs are SLOW on ARM64 (compile time)
# Run in background so supervisor can start immediately
# Services will gracefully handle missing modules via health checks
{
  log "Background: Installing better-sqlite3..."
  sudo -u abc bash << 'SQLITE_INSTALL_EOF'
export NVM_DIR=/config/nvm
export HOME=/config
# Unset npm_config_prefix to avoid NVM conflicts (set by LinuxServer base image)
export npm_config_cache=/config/.gmweb/npm-cache
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm install -g better-sqlite3 2>&1 | tail -3
SQLITE_INSTALL_EOF
  [ $? -eq 0 ] && log "✓ better-sqlite3 installed" || log "WARNING: better-sqlite3 install incomplete"

  log "Background: Installing bcrypt..."
  sudo -u abc bash << 'BCRYPT_INSTALL_EOF'
export NVM_DIR=/config/nvm
export HOME=/config
export GMWEB_DIR=/config/.gmweb
# Unset npm_config_prefix to avoid NVM conflicts (set by LinuxServer base image)
export npm_config_cache=/config/.gmweb/npm-cache
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd "$GMWEB_DIR/deps" && npm install bcrypt 2>&1 | tail -3
BCRYPT_INSTALL_EOF
  [ $? -eq 0 ] && log "✓ bcrypt installed" || log "WARNING: bcrypt install incomplete"

  sudo -u abc /tmp/gmweb-wrappers/npm-as-abc.sh npm cache clean --force 2>&1 | tail -1
  log "Background: Critical module installs complete"

  log "Background: Installing agent-browser (global binary)..."
  sudo -u abc bash << 'AGENT_BROWSER_INSTALL_EOF'
export NVM_DIR=/config/nvm
export HOME=/config
export GMWEB_DIR=/config/.gmweb
export npm_config_cache=/config/.gmweb/npm-cache
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
npm install -g agent-browser 2>&1 | tail -3
AGENT_BROWSER_INSTALL_EOF
  [ $? -eq 0 ] && log "✓ agent-browser installed" || log "WARNING: agent-browser install incomplete"

  log "Background: Running agent-browser install (download Chromium)..."
  sudo -u abc bash << 'AGENT_BROWSER_SETUP_EOF'
export NVM_DIR=/config/nvm
export HOME=/config
export GMWEB_DIR=/config/.gmweb
export npm_config_cache=/config/.gmweb/npm-cache
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
agent-browser install 2>&1 | tail -3
AGENT_BROWSER_SETUP_EOF
  [ $? -eq 0 ] && log "✓ agent-browser Chromium download complete" || log "WARNING: agent-browser setup incomplete"

  log "Background: Running agent-browser install --with-deps..."
  sudo -u abc bash << 'AGENT_BROWSER_DEPS_EOF'
export NVM_DIR=/config/nvm
export HOME=/config
export GMWEB_DIR=/config/.gmweb
export npm_config_cache=/config/.gmweb/npm-cache
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
agent-browser install --with-deps 2>&1 | tail -3
AGENT_BROWSER_DEPS_EOF
  [ $? -eq 0 ] && log "✓ agent-browser dependencies installed" || log "WARNING: agent-browser --with-deps incomplete"
} >> "$LOG_DIR/startup.log" 2>&1 &

log "✓ Critical modules background install started (supervisor will handle retries)"

# GitHub CLI already installed in Phase 0-apt (serial, consolidated)

log "Phase 1.5: Install Bun (BLOCKING - required by file-manager and agentgui services)"
export BUN_INSTALL="/config/.gmweb/cache/.bun"
log "  BUN_INSTALL=$BUN_INSTALL"

# CRITICAL: Always force fresh Bun installation on every boot
# Delete existing Bun to prevent stale cached state (gmweb philosophy)
log "  Removing any existing Bun installation (force fresh state)..."
rm -rf "$BUN_INSTALL" 2>/dev/null || true
mkdir -p "$BUN_INSTALL"

log "  Installing fresh latest Bun..."
# CRITICAL: Bun must be available before supervisor starts
# Detect system architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) BUN_ARCH="x64" ;;
  aarch64) BUN_ARCH="aarch64" ;;
  arm64) BUN_ARCH="aarch64" ;;  # macOS
  *) BUN_ARCH="$ARCH" ;;
esac

# SIMPLE, DIRECT BUN INSTALLATION (NO FALLBACKS, NO CONDITIONALS)
log "  Downloading Bun from GitHub..."
BUN_URL="https://github.com/oven-sh/bun/releases/latest/download/bun-linux-${BUN_ARCH}.zip"

# Step 1: Download
curl -fsSL --connect-timeout 10 --max-time 60 "$BUN_URL" -o "$BUN_INSTALL/bun.zip"
log "✓ Downloaded bun ($(du -h $BUN_INSTALL/bun.zip | cut -f1))"

# Step 2: Extract (unzip GUARANTEED to exist from Phase 0-apt)
/usr/bin/unzip -q "$BUN_INSTALL/bun.zip" -d "$BUN_INSTALL"
log "✓ Bun archive extracted"

# Step 3: Install binary
mkdir -p "$BUN_INSTALL/bin"
mv "$BUN_INSTALL/bun-linux-${BUN_ARCH}/bun" "$BUN_INSTALL/bin/bun"
chmod +x "$BUN_INSTALL/bin/bun"
ln -sf bun "$BUN_INSTALL/bin/bunx"
rm -rf "$BUN_INSTALL/bun.zip" "$BUN_INSTALL/bun-linux-${BUN_ARCH}"

# Step 4: Add to PATH and verify
export PATH="$BUN_INSTALL/bin:$PATH"
log "✓ Bun installed and verified: $($BUN_INSTALL/bin/bun --version)"

log "Phase 1.6: Install CLI coding tools (opencode/Claude Code) - BLOCKING (required for services)"
# CRITICAL: opencode must be installed BEFORE supervisor starts
# Services need Claude Code in PATH - cannot wait for background installs
export OPENCODE_INSTALL_DIR="$GMWEB_DIR/tools"
mkdir -p "$OPENCODE_INSTALL_DIR"

log "  Installing opencode CLI..."
NPM_CONFIG_PREFIX= bash << 'OPENCODE_INSTALL_EOF'
  export NVM_DIR=/config/nvm
  export GMWEB_DIR=/config/.gmweb
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

   if [ -f "$GMWEB_DIR/tools/opencode/bin/opencode" ] || command -v opencode &>/dev/null; then
     echo "  ✓ opencode already installed"
   else
     mkdir -p "$GMWEB_DIR/tools"
     if timeout 60 curl -fsSL https://opencode.ai/install | bash 2>&1 | tail -3; then
       if [ -f "$GMWEB_DIR/tools/opencode/bin/opencode" ] || command -v opencode &>/dev/null; then
         echo "  ✓ Fresh opencode installed"
       else
         echo "  WARNING: opencode installer completed but binary not verified"
       fi
     else
       echo "  WARNING: opencode installation failed (will retry in background)"
     fi
   fi
OPENCODE_INSTALL_EOF

# CRITICAL: After subshell completes, verify opencode exists and add to PATH in PARENT shell
if [ -f "$OPENCODE_INSTALL_DIR/opencode/bin/opencode" ]; then
  log "✓ opencode binary verified at $OPENCODE_INSTALL_DIR/opencode/bin/opencode"
  export PATH="$OPENCODE_INSTALL_DIR/opencode/bin:$PATH"
  log "✓ opencode bin directory added to PATH"
elif command -v opencode &>/dev/null; then
  log "✓ opencode available in PATH"
else
  log "WARNING: opencode not found, will proceed without it"
fi

log "Phase 1.7: Install glootie-oc opencode plugin (BLOCKING - required for MCP tool integration)"
# CRITICAL: Install glootie-oc plugin from GitHub
# This provides MCP tool integration and Claude Code agent capabilities
GLOOTIE_PLUGIN_DIR="$HOME_DIR/.config/opencode/glootie-oc"
log "  Setting up glootie-oc plugin directory: $GLOOTIE_PLUGIN_DIR"

# Remove old directory and clone fresh
rm -rf "$GLOOTIE_PLUGIN_DIR"
mkdir -p "$GLOOTIE_PLUGIN_DIR"

# Clone from GitHub
log "  Cloning glootie-oc from GitHub..."
if git clone --depth 1 https://github.com/AnEntrypoint/glootie-oc.git "$GLOOTIE_PLUGIN_DIR" 2>&1 | tail -3; then
  log "✓ glootie-oc cloned from GitHub"
  
  # Try to install dependencies (may fail on native modules but that's ok)
  log "  Installing dependencies..."
  (cd "$GLOOTIE_PLUGIN_DIR" && npm install --silent 2>&1 | tail -3) || \
    log "  Note: Some dependencies failed (plugin will work without them)"
  
  chown -R abc:abc "$GLOOTIE_PLUGIN_DIR"
  chmod -R u+rwX,g+rX,o-rwx "$GLOOTIE_PLUGIN_DIR"
  log "✓ glootie-oc plugin ready"
else
  log "WARNING: Failed to clone glootie-oc"
fi

log "Phase 1.7 complete - glootie-oc plugin ready for MCP tools"

log "Starting supervisor..."
# CRITICAL: Explicitly unset npm_config_prefix/NPM_CONFIG_PREFIX before supervisor
# These conflict with NVM and must not be passed to child processes
unset NPM_CONFIG_PREFIX

if [ -f /opt/gmweb-startup/start.sh ]; then
  # CRITICAL: Do NOT pass npm_config_prefix/NPM_CONFIG_PREFIX to supervisor
  # start.sh will set these AFTER sourcing NVM (using .nvm_restore.sh)
  # Passing them in environment causes NVM to fail to load
  # CRITICAL: Pass essential environment variables to supervisor
  # start.sh handles npm config vars after loading NVM safely
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
  log "This is critical - supervisor will not start"
fi

# Launch XFCE components in background (after supervisor is running)
bash /tmp/launch_xfce_components.sh >> "$LOG_DIR/startup.log" 2>&1 &
log "XFCE component launcher started (PID: $!)"

# All system packages are already installed in Phase 0-apt (consolidated, blocking phase)

{
  # CRITICAL: Source NVM in subshell so npm/node commands work
  # Must use NVM compat shim to hide NPM_CONFIG_PREFIX before sourcing NVM
  export NVM_DIR=/config/nvm
  export HOME=/config
  export GMWEB_DIR=/config/.gmweb

  # Hide NPM_CONFIG_PREFIX before NVM (NVM refuses to load with it set)
  . /config/.nvm_compat.sh
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  # Restore npm config after NVM is loaded
  . /config/.nvm_restore.sh

  # All system packages already installed in Phase 0-apt (BLOCKING phase before supervisor)
  # This background block now handles npm-based installs only

  bash /opt/gmweb-startup/install.sh 2>&1 | tail -10
  log "Background installations complete"

  # Note: opencode already installed during blocking phase 1.6
  # (moved before supervisor start to ensure it's available for services)

  log "Installing cloud and deployment tools (wrangler)..."
  npm install -g wrangler 2>&1 | tail -3 && log "wrangler installed" || log "WARNING: wrangler install failed"
  log "Cloud and deployment tools installation complete"

  touch /tmp/gmweb-installs-complete
  log "Installation marker file created"
} >> "$LOG_DIR/startup.log" 2>&1 &
log "Background npm-based installs started (PID: $!)"

[ -f "$HOME_DIR/startup.sh" ] && bash "$HOME_DIR/startup.sh" 2>&1 | tee -a "$LOG_DIR/startup.log"

# CRITICAL: Final comprehensive ownership and permissions pass
# Ensures ZERO root-owned files exist in /config after entire boot process
# This is THE MOST IMPORTANT STEP - catches any files created by background/parallel processes
log "FINAL PHASE: Aggressive ownership enforcement (no root files allowed)..."

# Stage 1: Recursively fix ALL files/dirs in critical directories
for dir in /config/.gmweb /config/.nvm /config/.local /config/.cache /config/.config /config/workspace; do
  if [ -d "$dir" ]; then
    log "  Stage 1: Fixing all permissions in $dir..."
    sudo find "$dir" -type d -exec chown abc:abc {} \; 2>/dev/null || true
    sudo find "$dir" -type f -exec chown abc:abc {} \; 2>/dev/null || true
    sudo find "$dir" -type d -exec chmod u+rwX,g+rX,o-rwx {} \; 2>/dev/null || true
    sudo find "$dir" -type f -exec chmod u+rw,g+r,o-rwx {} \; 2>/dev/null || true
  fi
done

# Stage 2: Delete npm cache if it has ANY root-owned files (corrupted state)
if [ -d /config/.gmweb/npm-cache ]; then
  if sudo find /config/.gmweb/npm-cache -not -user 1000 2>/dev/null | grep -q .; then
    log "  Stage 2: Root-owned files found in npm cache - DELETING entire cache..."
    sudo rm -rf /config/.gmweb/npm-cache
    mkdir -p /config/.gmweb/npm-cache
    chmod 777 /config/.gmweb/npm-cache
    log "  ✓ npm cache deleted and recreated"
  fi
fi

# Stage 3: Delete npm-global if it has ANY root-owned files (corrupted state)
if [ -d /config/.gmweb/npm-global ]; then
  if sudo find /config/.gmweb/npm-global -not -user 1000 2>/dev/null | grep -q .; then
    log "  Stage 3: Root-owned files found in npm-global - DELETING entire directory..."
    sudo rm -rf /config/.gmweb/npm-global
    mkdir -p /config/.gmweb/npm-global
    chmod 777 /config/.gmweb/npm-global
    log "  ✓ npm-global deleted and recreated"
  fi
fi

# Stage 4: Aggressive final pass - nuke any remaining root files
ROOT_FILES=$(sudo find /config -not -user 1000 -not -path "/config/.git/*" 2>/dev/null | wc -l)
if [ "$ROOT_FILES" -gt 0 ]; then
  log "  Stage 4: Found $ROOT_FILES root-owned files - forcing ownership change..."
  sudo find /config -not -user 1000 -not -path "/config/.git/*" -exec chown abc:abc {} \; 2>/dev/null || true
  log "  ✓ All root-owned files reassigned to abc"
fi

# Stage 5: Final verification
log "✓ Final ownership enforcement complete"

# Verify absolutely ZERO root files remain (except .git which is ok)
REMAINING_ROOT=$(sudo find /config -not -user 1000 -not -path "/config/.git/*" 2>/dev/null | wc -l)
if [ "$REMAINING_ROOT" -gt 0 ]; then
  log "ERROR: Still found $REMAINING_ROOT root-owned files after final pass!"
  log "  List (first 10):"
  sudo find /config -not -user 1000 -not -path "/config/.git/*" 2>/dev/null | head -10 | while read f; do
    log "    - $f"
  done
  log "CRITICAL: This will cause npm EACCES errors"
else
  log "✓ VERIFIED: ZERO root-owned files in /config (excluding .git)"
fi

# Set working directory to /config for any subsequent processes
cd /config
log "✓ Working directory set to /config"

log "===== GMWEB STARTUP COMPLETE ====="
exit 0
