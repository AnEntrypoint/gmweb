#!/bin/bash
set -e

export LD_PRELOAD=/usr/local/lib/libshim_close_range.so

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

ABC_UID=$(id -u abc 2>/dev/null || echo 1000)
ABC_GID=$(id -g abc 2>/dev/null || echo 1000)
RUNTIME_DIR="/run/user/$ABC_UID"

mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"
chown "$ABC_UID:$ABC_GID" "$RUNTIME_DIR"

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

cp /opt/gmweb-startup/nginx-sites-enabled-default /etc/nginx/sites-available/default

if [ -z "${PASSWORD}" ]; then
  PASSWORD="password"
  log "Using default password"
else
  log "Using PASSWORD from env"
fi
printf '%s' "$PASSWORD" | openssl passwd -apr1 -stdin | { read hash; printf 'abc:%s\n' "$hash" > /etc/nginx/.htpasswd; }
chmod 644 /etc/nginx/.htpasswd
sleep 1
nginx -s reload 2>/dev/null || true
log "HTTP Basic Auth configured (user: abc)"
export PASSWORD

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
export LD_PRELOAD=/usr/local/lib/libshim_close_range.so
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

log "Setting up supervisor (force-fresh every boot)..."
rm -rf /tmp/gmweb
git clone --depth 1 --single-branch --branch main https://github.com/AnEntrypoint/gmweb.git /tmp/gmweb 2>&1 | tail -3

KEEP_SCRIPTS="/tmp/_keep_docker_scripts"
mkdir -p "$KEEP_SCRIPTS"
cp /opt/gmweb-startup/custom_startup.sh "$KEEP_SCRIPTS/" 2>/dev/null || true

rm -rf /opt/gmweb-startup/node_modules /opt/gmweb-startup/lib \
       /opt/gmweb-startup/services /opt/gmweb-startup/package* \
       /opt/gmweb-startup/*.js /opt/gmweb-startup/*.json /opt/gmweb-startup/*.sh

cp -r /tmp/gmweb/startup/* /opt/gmweb-startup/
cp /tmp/gmweb/docker/nginx-sites-enabled-default /opt/gmweb-startup/
cp /opt/gmweb-startup/nginx-sites-enabled-default /etc/nginx/sites-available/default
cp "$KEEP_SCRIPTS/custom_startup.sh" /opt/gmweb-startup/ 2>/dev/null || true
rm -rf /tmp/gmweb "$KEEP_SCRIPTS"

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
  sudo -u abc DISPLAY=:1 DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
    XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" LD_PRELOAD=/usr/local/lib/libshim_close_range.so \
    xfce4-panel >/dev/null 2>&1 &
  log "xfce4-panel started (PID: $!)"
fi

# Desktop (wallpaper, icons)
if ! pgrep -u abc xfdesktop >/dev/null 2>&1; then
  sudo -u abc DISPLAY=:1 DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
    XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" LD_PRELOAD=/usr/local/lib/libshim_close_range.so \
    xfdesktop >/dev/null 2>&1 &
  log "xfdesktop started (PID: $!)"
fi

# Window Manager (borders, titles, Alt+Tab)
if ! pgrep -u abc xfwm4 >/dev/null 2>&1; then
  sudo -u abc DISPLAY=:1 DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
    XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" LD_PRELOAD=/usr/local/lib/libshim_close_range.so \
    xfwm4 >/dev/null 2>&1 &
  log "xfwm4 started (PID: $!)"
fi

log "XFCE component launcher complete"
XFCE_LAUNCHER_EOF

chmod +x /tmp/launch_xfce_components.sh
log "XFCE launcher script prepared"

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
  npm install -g better-sqlite3 2>&1 | tail -3
  mkdir -p /config/node_modules
  cd /config && npm install bcrypt 2>&1 | tail -3
  chown -R abc:abc /config/node_modules
  log "better-sqlite3 + bcrypt installed"

  apt-get update
  apt-get install -y --no-install-recommends git curl lsof sudo 2>&1 | tail -3
  bash /opt/gmweb-startup/install.sh 2>&1 | tail -10
  log "Background installations complete"

  # Mark installations complete so supervisor can start AionUI
  touch /tmp/gmweb-installs-complete
  log "Installation marker file created"
} >> "$LOG_DIR/startup.log" 2>&1 &
log "Background installs started (PID: $!)"

[ -f "$HOME_DIR/startup.sh" ] && bash "$HOME_DIR/startup.sh" 2>&1 | tee -a "$LOG_DIR/startup.log"

chown -R abc:abc "$HOME_DIR" 2>/dev/null || true
log "===== GMWEB STARTUP COMPLETE ====="
exit 0
