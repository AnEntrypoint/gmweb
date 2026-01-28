#!/bin/bash
set -e

HOME_DIR="/config"
LOG_DIR="$HOME_DIR/logs"
mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR"
chown abc:abc "$LOG_DIR"

log() {
  echo "[gmweb-startup] $(date '+%Y-%m-%d %H:%M:%S') $@" | tee -a "$LOG_DIR/startup.log"
}

BOOT_ID="$(date '+%s')-$$"
log "===== GMWEB STARTUP (boot: $BOOT_ID) ====="

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
export NVM_DIR="/usr/local/local/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$(dirname "$(which node 2>/dev/null || echo /usr/local/bin/node)"):/usr/local/bin:$PATH"
EOF
  touch "$BASHRC_MARKER"
fi

log "Phase 1 complete"

NVM_DIR=/usr/local/local/nvm
export NVM_DIR

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
export PATH="$NVM_DIR/versions/node/$(nvm current)/bin:$PATH"

NODE_VERSION=$(node -v | tr -d 'v')
NODE_BIN_DIR="$NVM_DIR/versions/node/v$NODE_VERSION/bin"
log "Node.js $NODE_VERSION"

for bin in node npm npx; do
  ln -sf "$NODE_BIN_DIR/$bin" /usr/local/bin/$bin
done
chmod 777 "$NODE_BIN_DIR"
chmod 777 "$NVM_DIR/versions/node/v$NODE_VERSION/lib/node_modules"

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

{
  if ! command -v tmux &>/dev/null; then
    apt-get update -qq 2>/dev/null
    apt-get install -y --no-install-recommends tmux xclip 2>&1 | tail -3
    log "tmux installed"
  fi

  ARCH=$(uname -m)
  TTYD_ARCH=$([ "$ARCH" = "x86_64" ] && echo "x86_64" || echo "aarch64")
  TTYD_URL="https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.${TTYD_ARCH}"

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

  npm install -g better-sqlite3 2>&1 | tail -3
  mkdir -p /config/node_modules
  cd /config && npm install bcrypt 2>&1 | tail -3
  chown -R abc:abc /config/node_modules
  log "better-sqlite3 + bcrypt installed"

  apt-get update
  apt-get install -y --no-install-recommends git curl lsof sudo 2>&1 | tail -3
  bash /opt/gmweb-startup/install.sh 2>&1 | tail -10
  log "Background installations complete"
} >> "$LOG_DIR/startup.log" 2>&1 &
log "Background installs started (PID: $!)"

[ -f "$HOME_DIR/startup.sh" ] && bash "$HOME_DIR/startup.sh" 2>&1 | tee -a "$LOG_DIR/startup.log"

chown -R abc:abc "$HOME_DIR" 2>/dev/null || true
log "===== GMWEB STARTUP COMPLETE ====="
exit 0
