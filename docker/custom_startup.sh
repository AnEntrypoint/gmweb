#!/bin/bash
# LinuxServer Webtop Custom Startup Script
# Optimized: nginx/desktop first (fast visible UI), tools install in background
set -e

HOME_DIR="/config"
LOG_DIR="$HOME_DIR/logs"
mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR"
chown abc:abc "$LOG_DIR"

log() {
  echo "[gmweb-startup] $(date '+%Y-%m-%d %H:%M:%S') $@" | tee -a "$LOG_DIR/startup.log"
}

log "===== GMWEB STARTUP ====="
log "Initializing system..."

# ============================================================================
# PHASE 0: Deploy nginx config FIRST (before nginx starts)
# ============================================================================
log "Deploying nginx configuration..."
if [ -f /opt/gmweb-startup/nginx-sites-enabled-default ]; then
  cp /opt/gmweb-startup/nginx-sites-enabled-default /etc/nginx/sites-available/default
  log "✓ nginx config deployed (port 80/443)"
fi

log "Creating HTTP Basic Auth credentials..."
if [ -z "${PASSWORD}" ]; then
  PASSWORD="test123"
  log "  Using default password (set PASSWORD env var to override)"
else
  log "  Using PASSWORD env var"
fi
echo "abc:$(openssl passwd -apr1 "$PASSWORD")" > /etc/nginx/.htpasswd
chmod 644 /etc/nginx/.htpasswd
sleep 1
nginx -s reload 2>/dev/null || true
log "✓ HTTP Basic Auth configured (user: abc)"
export PASSWORD

# ============================================================================
# PHASE 1: Quick init (permissions, config, paths) - SYNCHRONOUS
# ============================================================================

# Fix npm permissions
[ -d "$HOME_DIR/.npm" ] && chown -R abc:abc "$HOME_DIR/.npm" 2>/dev/null || mkdir -p "$HOME_DIR/.npm" && chown -R abc:abc "$HOME_DIR/.npm"

# Copy ProxyPilot config if not present
[ -f /opt/proxypilot-config.yaml ] && [ ! -f "$HOME_DIR/config.yaml" ] && cp /opt/proxypilot-config.yaml "$HOME_DIR/config.yaml" && chown abc:abc "$HOME_DIR/config.yaml"

# Setup .bashrc PATH (first boot only)
BASHRC_MARKER="$HOME_DIR/.gmweb-bashrc-setup"
if [ ! -f "$BASHRC_MARKER" ]; then
  cat >> "$HOME_DIR/.bashrc" << 'EOF'
export PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin:/usr/local/bin:$PATH"
export NVM_DIR="/usr/local/local/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
EOF
  touch "$BASHRC_MARKER"
fi

log "✓ Phase 1 complete: System initialized"

# ============================================================================
# PHASE 2: Install Node.js (needed for supervisor) - SYNCHRONOUS
# ============================================================================
log "Installing Node.js (required for supervisor)..."

NVM_DIR=/usr/local/local/nvm
NODE_BIN="$NVM_DIR/versions/node/v23.11.1/bin/node"
if [ ! -f "$NODE_BIN" ]; then
  mkdir -p "$NVM_DIR"
  export NVM_DIR
  log "Downloading and installing nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash 2>&1 | tail -3
  log "✓ nvm installed"

  export NVM_DIR="/usr/local/local/nvm"
  . "$NVM_DIR/nvm.sh"
  log "Installing Node.js 23.11.1..."
  nvm install 23.11.1 2>&1 | tail -5
  nvm use 23.11.1 2>&1 | tail -2
  nvm alias default 23.11.1 2>&1 | tail -2
  log "✓ Node.js installed"
else
  log "✓ Node.js already installed"
fi

for bin in node npm npx; do
  ln -sf $NVM_DIR/versions/node/v23.11.1/bin/$bin /usr/local/bin/$bin
done

chmod 777 $NVM_DIR/versions/node/v23.11.1/bin
chmod 777 $NVM_DIR/versions/node/v23.11.1/lib/node_modules

# ============================================================================
# PHASE 3: Setup supervisor (gmweb startup system) - SYNCHRONOUS
# ============================================================================
log "Setting up supervisor and startup system..."

if [ ! -f /opt/gmweb-startup/start.sh ]; then
  git clone --depth 1 --single-branch --branch temp-main https://github.com/AnEntrypoint/gmweb.git /tmp/gmweb 2>&1 | tail -3
  cp -r /tmp/gmweb/startup/* /opt/gmweb-startup/
  rm -rf /tmp/gmweb
fi

cd /opt/gmweb-startup && \
  npm install --production --omit=dev 2>&1 | tail -3 && \
  chmod +x install.sh start.sh index.js && \
  chmod -R go+rx . && \
  chown -R root:root . && \
  chmod 755 .

log "✓ Supervisor system ready"

# ============================================================================
# PHASE 4: Start supervisor as abc user (manages additional services)
# ============================================================================
log "Starting supervisor..."

if [ -f /opt/gmweb-startup/start.sh ]; then
  sudo -u abc -H -E bash /opt/gmweb-startup/start.sh 2>&1 | tee -a "$LOG_DIR/startup.log" &
  SUPERVISOR_PID=$!
  sleep 2
  if kill -0 $SUPERVISOR_PID 2>/dev/null; then
    log "✓ Supervisor started (PID: $SUPERVISOR_PID)"
  else
    log "WARNING: Supervisor may have failed to start (continuing anyway)"
  fi
else
  log "ERROR: start.sh not found"
  exit 1
fi

# ============================================================================
# PHASE 5: Background tools installation (doesn't block UI)
# ============================================================================
log "Starting background tool installations..."

# Background: Install system packages and optional tools
{
  log "Installing system packages..."
  apt-get update
  apt-get install -y --no-install-recommends git curl lsof sudo 2>&1 | tail -3
  log "✓ System packages installed"

  # Background: Run install.sh (installs all optional services/tools)
  log "Installing optional tools (may take time)..."
  bash /opt/gmweb-startup/install.sh 2>&1 | tail -10
  log "✓ Optional tools installed"

  log "Background installations complete"
} >> "$LOG_DIR/startup.log" 2>&1 &

BG_INSTALL_PID=$!
log "Background installs running in background (PID: $BG_INSTALL_PID)"

# ============================================================================
# PHASE 6: Check for user startup hook
# ============================================================================
if [ -f "$HOME_DIR/startup.sh" ]; then
  log "Running user startup hook..."
  bash "$HOME_DIR/startup.sh" 2>&1 | tee -a "$LOG_DIR/startup.log"
  log "✓ User startup hook completed"
fi

# ============================================================================
# Fix ownership of files created as root
# ============================================================================
chown -R abc:abc "$HOME_DIR" 2>/dev/null || true

log "===== GMWEB STARTUP COMPLETE (nginx + desktop ready, tools installing in background) ====="
exit 0
