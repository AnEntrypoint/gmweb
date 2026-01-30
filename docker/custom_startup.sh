#!/bin/bash
set -e

# CRITICAL: Unset LD_PRELOAD immediately before anything else
unset LD_PRELOAD

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
  log "Using default password"
else
  log "Using PASSWORD from env"
fi
# Generate hash and write htpasswd (always use /dev/stdin to safely handle special chars)
HASH=$(printf '%s' "$PASSWORD" | openssl passwd -apr1 -stdin)
if [ -z "$HASH" ] || ! echo "$HASH" | grep -q "^\$apr1\$"; then
  log "ERROR: Failed to generate valid apr1 hash for password"
  exit 1
fi
echo "abc:$HASH" | sudo tee /etc/nginx/.htpasswd > /dev/null
sudo chmod 644 /etc/nginx/.htpasswd
# Verify htpasswd was written correctly
if ! sudo grep -q "^abc:\$apr1\$" /etc/nginx/.htpasswd; then
  log "ERROR: htpasswd file is invalid or not properly written"
  exit 1
fi
sudo nginx -s reload 2>/dev/null || true
export PASSWORD
log "✓ HTTP Basic Auth configured with valid apr1 hash"

# Clean up stale LD_PRELOAD from persistent .profile (can get stale from failed runs)
if [ -f "$HOME_DIR/.profile" ]; then
  grep -v "LD_PRELOAD" "$HOME_DIR/.profile" > "$HOME_DIR/.profile.tmp" && \
  mv "$HOME_DIR/.profile.tmp" "$HOME_DIR/.profile" || true
  log "✓ Cleaned stale LD_PRELOAD from .profile"
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

# NOW set LD_PRELOAD - shim is guaranteed to exist
export LD_PRELOAD=/opt/lib/libshim_close_range.so

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
log "Cleaning persistent volume artifacts..."
rm -rf /config/.npm 2>/dev/null || true
rm -rf /config/node_modules/.bin/* 2>/dev/null || true
npm cache clean --force 2>/dev/null || true

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

[ -d "$HOME_DIR/.npm" ] && chown -R abc:abc "$HOME_DIR/.npm" 2>/dev/null || mkdir -p "$HOME_DIR/.npm" && chown -R abc:abc "$HOME_DIR/.npm"
[ -f /opt/proxypilot-config.yaml ] && [ ! -f "$HOME_DIR/config.yaml" ] && cp /opt/proxypilot-config.yaml "$HOME_DIR/config.yaml" && chown abc:abc "$HOME_DIR/config.yaml"

BASHRC_MARKER="$HOME_DIR/.gmweb-bashrc-setup"
if [ ! -f "$BASHRC_MARKER" ]; then
  cat >> "$HOME_DIR/.bashrc" << 'EOF'
export NVM_DIR="/config/nvm"
export NPM_CONFIG_PREFIX="/config/usr/local"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$(dirname "$(which node 2>/dev/null || echo /config/usr/local/bin/node)"):/config/usr/local/bin:$PATH"
EOF
  touch "$BASHRC_MARKER"
fi

grep -q 'NVM_DIR=/config/nvm' "$HOME_DIR/.profile" || \
  cat >> "$HOME_DIR/.profile" << 'PROFILE_EOF'
export NVM_DIR="/config/nvm"
export NPM_CONFIG_PREFIX="/config/usr/local"
export LD_PRELOAD=/opt/lib/libshim_close_range.so
PROFILE_EOF

# Add temp directory configuration to profile (prevents EXDEV errors in Claude plugin installation)
grep -q 'export TMPDIR=' "$HOME_DIR/.profile" || {
  cat >> "$HOME_DIR/.profile" << 'TMPDIR_EOF'
export TMPDIR="${HOME}/.tmp"
export TMP="${HOME}/.tmp"
export TEMP="${HOME}/.tmp"
mkdir -p "${TMPDIR}" 2>/dev/null || true
TMPDIR_EOF
}

log "Phase 1 complete"

# MIGRATION: Handle transition from old paths to new persistent paths
log "Verifying persistent path structure..."
mkdir -p /config/usr/local/lib /config/usr/local/bin /config/nvm /config/.tmp /config/logs
chmod 755 /config/usr/local /config/usr/local/lib /config/usr/local/bin /config/nvm /config/.tmp /config/logs 2>/dev/null || true

# If old NVM exists in /usr/local/local, migrate it
if [ -d "/usr/local/local/nvm" ] && [ ! -e "/config/nvm/nvm.sh" ]; then
  log "Migrating NVM from /usr/local/local/nvm to /config/nvm"
  rm -rf /config/nvm && mv /usr/local/local/nvm /config/nvm 2>/dev/null || true
fi
# Clean up any stale old paths that might interfere
rm -rf /usr/local/local 2>/dev/null || true

# Verify symlink is correct
if [ ! -L /usr/local ]; then
  log "WARNING: /usr/local is not a symlink, attempting to fix"
  rm -rf /usr/local 2>/dev/null || true
  ln -s /config/usr/local /usr/local
fi

# Verify symlink target is correct
SYMLINK_TARGET=$(readlink /usr/local 2>/dev/null)
if [ "$SYMLINK_TARGET" != "/config/usr/local" ]; then
  log "WARNING: /usr/local symlink incorrect ($SYMLINK_TARGET), fixing to /config/usr/local"
  rm -f /usr/local && ln -s /config/usr/local /usr/local
fi

NVM_DIR=/config/nvm
export NVM_DIR
log "Persistent paths ready: NVM_DIR=$NVM_DIR"

# Don't set NPM_CONFIG_PREFIX yet - NVM rejects it
# Source NVM first, then set it after NVM is initialized
if ! command -v node &>/dev/null; then
  mkdir -p "$NVM_DIR"
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>&1 | tail -3
  . "$NVM_DIR/nvm.sh"
  nvm install --lts 2>&1 | tail -5
  nvm use default 2>&1 | tail -2
  log "Node.js installed"
else
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  log "Node.js already installed"
fi

. "$NVM_DIR/nvm.sh"
export NPM_CONFIG_PREFIX=/config/usr/local
export PATH="$NVM_DIR/versions/node/$(nvm current)/bin:/config/usr/local/bin:$PATH"

# Configure npm globally (write with proper error handling)
mkdir -p /etc/npm 2>/dev/null || true
# Configure npm with sudo (needs root permissions)
sudo sh -c "echo 'prefix = /config/usr/local' > /etc/npmrc" 2>/dev/null || log "WARNING: Could not write /etc/npmrc"

# Set npm environment in /etc/environment for all shell sessions (safe append, use sudo)
[ -f /etc/environment ] && grep -q 'NVM_DIR=/config/nvm' /etc/environment || sudo sh -c "echo 'NVM_DIR=/config/nvm' >> /etc/environment" 2>/dev/null || true
[ -f /etc/environment ] && grep -q 'NPM_CONFIG_PREFIX' /etc/environment || sudo sh -c "echo 'NPM_CONFIG_PREFIX=/config/usr/local' >> /etc/environment" 2>/dev/null || true

NODE_VERSION=$(node -v | tr -d 'v')
NODE_BIN_DIR="$NVM_DIR/versions/node/v$NODE_VERSION/bin"
log "Node.js $NODE_VERSION (NVM_DIR=$NVM_DIR)"

mkdir -p /config/usr/local/bin
for bin in node npm npx; do
  ln -sf "$NODE_BIN_DIR/$bin" /config/usr/local/bin/$bin
done
chmod 777 "$NODE_BIN_DIR"
chmod 777 "$NVM_DIR/versions/node/v$NODE_VERSION/lib/node_modules" 2>/dev/null || true
chmod 777 /config/usr/local/bin 2>/dev/null || true

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
  TTYD_RETRY=3
  while [ $TTYD_RETRY -gt 0 ]; do
    if timeout 60 curl -fL --max-redirs 5 -o /tmp/ttyd "$TTYD_URL" 2>/dev/null && [ -f /tmp/ttyd ] && [ -s /tmp/ttyd ]; then
      sudo mv /tmp/ttyd /usr/bin/ttyd
      sudo chmod +x /usr/bin/ttyd
      log "ttyd installed"
      break
    else
      TTYD_RETRY=$((TTYD_RETRY - 1))
      [ $TTYD_RETRY -gt 0 ] && sleep 3
    fi
  done
  [ ! -f /usr/bin/ttyd ] && log "WARNING: ttyd failed"
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
export NPM_CONFIG_PREFIX=/config/usr/local

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
  sudo -u abc -H -E bash /opt/gmweb-startup/start.sh 2>&1 | tee -a "$LOG_DIR/startup.log" &
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
  apt-get update
  apt-get install -y --no-install-recommends git curl lsof sudo 2>&1 | tail -3
  bash /opt/gmweb-startup/install.sh 2>&1 | tail -10
  log "Background installations complete"

  log "Installing CLI coding tools (qwen-code, codex, cursor)..."
  npm install -g @qwen-code/qwen-code@latest 2>&1 | tail -3 && log "qwen-code installed" || log "WARNING: qwen-code install failed"
  npm install -g @openai/codex 2>&1 | tail -3 && log "codex installed" || log "WARNING: codex install failed"
  curl -fsSL https://cursor.com/install 2>/dev/null | bash 2>&1 | tail -5 && log "cursor CLI installed" || log "WARNING: cursor CLI install failed"
  log "CLI coding tools installation complete"

  touch /tmp/gmweb-installs-complete
  log "Installation marker file created"
} >> "$LOG_DIR/startup.log" 2>&1 &
log "Background installs started (PID: $!)"

[ -f "$HOME_DIR/startup.sh" ] && bash "$HOME_DIR/startup.sh" 2>&1 | tee -a "$LOG_DIR/startup.log"

chown -R abc:abc "$HOME_DIR" 2>/dev/null || true
log "===== GMWEB STARTUP COMPLETE ====="
exit 0
