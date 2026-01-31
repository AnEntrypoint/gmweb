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

# Clean up stale environment vars from persistent .profile (can get stale from failed runs)
if [ -f "$HOME_DIR/.profile" ]; then
  grep -v -E "LD_PRELOAD|NPM_CONFIG_PREFIX" "$HOME_DIR/.profile" > "$HOME_DIR/.profile.tmp" && \
  mv "$HOME_DIR/.profile.tmp" "$HOME_DIR/.profile" || true
  log "✓ Cleaned stale environment variables from .profile"
fi

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
npm cache clean --force 2>/dev/null || true

# Create global npm configuration to prevent permission issues
# Use a cache directory and set proper permissions
mkdir -p /config/.npm
sudo chown -R abc:abc /config/.npm 2>/dev/null || true
sudo chmod -R 755 /config/.npm 2>/dev/null || true

cat > /tmp/npmrc << 'NPMRC_EOF'
cache=/config/.npm
prefix=/config/usr/local
NPMRC_EOF
sudo cp /tmp/npmrc /etc/npmrc 2>/dev/null || true
rm -f /tmp/npmrc

# Create npm wrapper script that ensures cache consistency
mkdir -p /config/usr/local/bin
cat > /config/usr/local/bin/npm-wrapper << 'WRAPPER_EOF'
#!/bin/bash
# NPM wrapper - ensures cache permissions before running npm
sudo chown -R abc:abc /config/.npm 2>/dev/null || true
exec /config/usr/local/bin/npm.real "$@"
WRAPPER_EOF
chmod +x /config/usr/local/bin/npm-wrapper

# Backup original npm and create wrapper
if [ -f /config/usr/local/bin/npm ] && [ ! -f /config/usr/local/bin/npm.real ]; then
  sudo mv /config/usr/local/bin/npm /config/usr/local/bin/npm.real 2>/dev/null || true
  sudo ln -sf /config/usr/local/bin/npm-wrapper /config/usr/local/bin/npm 2>/dev/null || true
fi

log "✓ npm configuration and wrapper set"

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

log "Phase 1: Git clone - get startup files and nginx config (minimal history)"
rm -rf /tmp/gmweb /opt/gmweb-startup/node_modules /opt/gmweb-startup/lib \
       /opt/gmweb-startup/services /opt/gmweb-startup/package* \
       /opt/gmweb-startup/*.js /opt/gmweb-startup/*.json /opt/gmweb-startup/*.sh 2>/dev/null || true

mkdir -p /opt/gmweb-startup

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

sudo mkdir -p "$HOME_DIR/.npm" 2>/dev/null && sudo chown -R abc:abc "$HOME_DIR/.npm" 2>/dev/null || true

PROFILE_MARKER="$HOME_DIR/.gmweb-profile-setup"
if [ ! -f "$PROFILE_MARKER" ]; then
  # Set up .profile once with all necessary environment variables
  cat > "$HOME_DIR/.profile" << 'PROFILE_EOF'
export TMPDIR="${HOME}/.tmp"
export TMP="${HOME}/.tmp"
export TEMP="${HOME}/.tmp"
mkdir -p "${TMPDIR}" 2>/dev/null || true

export NVM_DIR="/config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
PROFILE_EOF
  touch "$PROFILE_MARKER"
  log "✓ Cleaned stale environment variables from .profile"
fi

BASHRC_MARKER="$HOME_DIR/.gmweb-bashrc-setup"
# Clean stale bashrc entries from previous failed/broken setups
if [ -f "$HOME_DIR/.bashrc" ]; then
  # Remove old broken NVM_DIR entries (e.g., /usr/local/local/nvm)
  grep -v "export NVM_DIR=" "$HOME_DIR/.bashrc" > "$HOME_DIR/.bashrc.tmp" && \
  mv "$HOME_DIR/.bashrc.tmp" "$HOME_DIR/.bashrc" || true
fi

if [ ! -f "$BASHRC_MARKER" ] || ! grep -q 'export NVM_DIR="/config/nvm"' "$HOME_DIR/.bashrc"; then
  # Ensure correct NVM setup is in bashrc
  cat >> "$HOME_DIR/.bashrc" << 'EOF'

# gmweb NVM setup - ensures Node.js is available in non-login shells
export NVM_DIR="/config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
# nvm bash completion (optional)
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
EOF
  touch "$BASHRC_MARKER"
  log "✓ bashrc updated with correct NVM configuration"
fi

log "Phase 1 complete"

log "Verifying persistent path structure..."
mkdir -p /config/nvm /config/.tmp /config/logs
chmod 755 /config/nvm /config/.tmp /config/logs 2>/dev/null || true

NVM_DIR=/config/nvm
export NVM_DIR
log "Persistent paths ready: NVM_DIR=$NVM_DIR"

# Always source NVM if available
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Check if Node 23 is installed, if not install it
if ! command -v node &>/dev/null || ! node -v | grep -q "^v23\."; then
  mkdir -p "$NVM_DIR"
  
  # Install NVM if not present
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>&1 | tail -3
    . "$NVM_DIR/nvm.sh"
  fi
  
  # Install Node.js 23 (latest stable in v23.x line)
  nvm install 23 2>&1 | tail -5
  nvm alias default 23 2>&1 | tail -2
  nvm alias stable 23 2>&1 | tail -2
  nvm use 23 2>&1 | tail -2
  log "✓ Node.js 23 installed and set as default"
else
  # Node 23 already installed, just make sure it's active and aliased
  nvm use 23 2>&1 | tail -2 || true
  nvm alias default 23 2>&1 | tail -2 || true
  nvm alias stable 23 2>&1 | tail -2 || true
  log "✓ Node.js 23 already installed"
fi

NODE_VERSION=$(node -v | tr -d 'v')
log "Node.js $NODE_VERSION (NVM_DIR=$NVM_DIR)"

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

ARCH=$(uname -m)
TTYD_ARCH=$([ "$ARCH" = "x86_64" ] && echo "x86_64" || echo "aarch64")
TTYD_URL="https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.${TTYD_ARCH}"

if [ ! -f /usr/bin/ttyd ]; then
  log "Installing ttyd for webssh2..."
  # Try GitHub releases first
  TTYD_RETRY=2
  while [ $TTYD_RETRY -gt 0 ]; do
    if timeout 60 curl -fL --max-redirs 5 -o /tmp/ttyd "$TTYD_URL" 2>/dev/null && [ -f /tmp/ttyd ] && [ -s /tmp/ttyd ]; then
      sudo mv /tmp/ttyd /usr/bin/ttyd
      sudo chmod +x /usr/bin/ttyd
      log "✓ ttyd installed from GitHub"
      break
    else
      TTYD_RETRY=$((TTYD_RETRY - 1))
      [ $TTYD_RETRY -gt 0 ] && sleep 2
    fi
  done

  # Fallback to apt-get if GitHub download failed
  if [ ! -f /usr/bin/ttyd ]; then
    log "GitHub download failed, trying apt-get..."
    sudo apt-get update -qq 2>/dev/null && \
    sudo apt-get install -y ttyd 2>/dev/null && \
    log "✓ ttyd installed from apt-get" || \
    log "WARNING: ttyd installation failed from both GitHub and apt-get"
  fi
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
mkdir -p /config/.gmweb-deps

# Install with timeout - fail hard if anything goes wrong
timeout 30 npm install -g better-sqlite3 2>&1 | tail -2 || {
  log "ERROR: better-sqlite3 installation failed"
  exit 1
}

cd /config/.gmweb-deps && timeout 30 npm install bcrypt 2>&1 | tail -2 || {
  log "ERROR: bcrypt installation failed"
  exit 1
}

chown -R abc:abc /config/.gmweb-deps 2>/dev/null || true
log "✓ Critical modules installed"

log "Starting supervisor..."
if [ -f /opt/gmweb-startup/start.sh ]; then
  # Explicitly pass NVM_DIR and HOME to ensure Node.js is available
  # Use -E to preserve environment, but don't use -H (which breaks HOME for abc user)
  NVM_DIR=/config/nvm HOME=/config NODE_OPTIONS="--no-warnings" sudo -u abc -E bash /opt/gmweb-startup/start.sh 2>&1 | tee -a "$LOG_DIR/startup.log" &
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

  log "Installing CLI coding tools (qwen-code, codex, cursor)..."
  npm install -g @qwen-code/qwen-code@latest 2>&1 | tail -3 && log "qwen-code installed" || log "WARNING: qwen-code install failed"
  npm install -g @openai/codex 2>&1 | tail -3 && log "codex installed" || log "WARNING: codex install failed"
  curl -fsSL https://cursor.com/install 2>/dev/null | bash 2>&1 | tail -5 && log "cursor CLI installed" || log "WARNING: cursor CLI install failed"
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
log "===== GMWEB STARTUP COMPLETE ====="
exit 0
