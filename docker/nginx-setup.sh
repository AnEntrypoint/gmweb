#!/bin/bash
# NGINX-FIRST BLOCKING SETUP SCRIPT
# This script MUST complete successfully before anything else starts
# It configures nginx completely, starts it, and verifies listening on port 80
# Exit code 0 = nginx ready to serve requests
# Exit code 1 = FATAL error, system cannot proceed

set +e

HOME_DIR="/config"
LOG_DIR="$HOME_DIR/logs"

log() {
  local msg="[nginx-setup] $(date '+%Y-%m-%d %H:%M:%S') $@"
  echo "$msg"
  echo "$msg" >> "$LOG_DIR/startup.log" 2>/dev/null || echo "$msg"
  sync "$LOG_DIR/startup.log" 2>/dev/null || true
}

# Ensure log directory exists
mkdir -p "$LOG_DIR" 2>/dev/null || true

log "===== NGINX BLOCKING SETUP (Phase 0) ====="

# CRITICAL: Set PASSWORD default if not provided
if [ -z "${PASSWORD}" ]; then
  PASSWORD="password"
  log "WARNING: PASSWORD not set in environment, using fallback 'password'"
else
  log "✓ PASSWORD from environment (${#PASSWORD} chars)"
fi

# STEP 1: Generate HTTP Basic Auth credentials
log "Step 1: Generating HTTP Basic Auth credentials"

# Generate apr1 hash from PASSWORD
HASH=$(printf '%s' "$PASSWORD" | openssl passwd -apr1 -stdin 2>&1)
if [ $? -ne 0 ] || [ -z "$HASH" ]; then
  log "ERROR: openssl passwd failed to generate hash"
  exit 1
fi

# Validate hash format
if ! echo "$HASH" | grep -q '^\$apr1\$'; then
  log "ERROR: Invalid apr1 hash generated: $HASH"
  exit 1
fi

log "✓ APR1 hash generated successfully"

# STEP 2: Create nginx directories and write htpasswd
log "Step 2: Setting up nginx directories and htpasswd"

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled 2>/dev/null || true

# Write htpasswd file
echo "abc:$HASH" | sudo tee /etc/nginx/.htpasswd > /dev/null 2>&1
if [ $? -ne 0 ]; then
  log "ERROR: Failed to write /etc/nginx/.htpasswd"
  exit 1
fi

sudo chmod 644 /etc/nginx/.htpasswd 2>/dev/null || true

# Verify htpasswd was written correctly
if ! sudo grep -q '^abc:\$apr1\$' /etc/nginx/.htpasswd 2>/dev/null; then
  log "ERROR: htpasswd file is invalid or not properly written"
  exit 1
fi

log "✓ htpasswd file created and verified"

# STEP 3: Install nginx binary package
log "Step 3: Installing nginx binary package"

apt-get update -qq 2>/dev/null || true

# Install nginx (apt-get is preferred over GitHub binary for stability)
if ! apt-get install -y --no-install-recommends nginx 2>&1 | tail -2; then
  log "ERROR: Failed to install nginx via apt-get"
  exit 1
fi

# Verify nginx binary exists
if ! command -v nginx &>/dev/null; then
  log "ERROR: nginx binary not found after installation"
  exit 1
fi

log "✓ nginx binary installed and verified"

# STEP 4: Generate complete nginx configuration from git
log "Step 4: Deploying nginx configuration"

# Create default config if git hasn't provided it yet
# (git clone may not have completed, so we create a minimal working config)
if [ ! -f /opt/gmweb-startup/nginx-sites-enabled-default ]; then
  log "  WARNING: nginx-sites-enabled-default not in /opt/gmweb-startup yet"
  log "  Using embedded minimal config"

  # Create minimal but complete nginx config
  sudo tee /etc/nginx/sites-available/default > /dev/null << 'NGINX_EOF'
server {
  listen 80 default_server;
  listen [::]:80 default_server;

  location = / {
    auth_basic "Login Required";
    auth_basic_user_file /etc/nginx/.htpasswd;
    return 301 /gm/;
  }

  location / {
    auth_basic "Login Required";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://127.0.0.1:9897;
  }

  location /desk {
    auth_basic off;
    alias /usr/share/selkies/web/;
    index index.html index.htm;
    try_files $uri $uri/ =404;
  }

  location ~ /desk/websockets? {
    auth_basic off;
    rewrite ^/desk/(.*) /$1 break;
    proxy_pass http://127.0.0.1:8082;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_http_version 1.1;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
  }

  location /gm/ {
    auth_basic off;
    proxy_pass http://127.0.0.1:9897/gm/;
  }

  location /ssh/ {
    proxy_pass http://127.0.0.1:9999/;
  }

  location /files/ {
    proxy_pass http://127.0.0.1:9998/;
  }

  error_page 500 502 503 504 /50x.html;
  location = /50x.html {
    root /usr/share/nginx/html;
  }
}
NGINX_EOF
else
  log "  Deploying nginx config from git"
  sudo cp /opt/gmweb-startup/nginx-sites-enabled-default /etc/nginx/sites-available/default 2>/dev/null || true
fi

# Remove any old symlinks
sudo rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Create symlink to enable the site
sudo ln -s /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default 2>/dev/null || true

log "✓ nginx configuration deployed"

# STEP 5: Verify nginx configuration syntax
log "Step 5: Verifying nginx configuration syntax"

if ! sudo nginx -t 2>&1 | grep -q "successful"; then
  log "ERROR: nginx configuration syntax error"
  sudo nginx -t 2>&1 | head -10 | while read line; do log "  $line"; done
  exit 1
fi

log "✓ nginx configuration syntax verified"

# STEP 6: Start or reload nginx
log "Step 6: Starting nginx daemon"

# Kill any existing nginx processes
sudo pkill -f "nginx: master" 2>/dev/null || true
sleep 1

# Start nginx
if ! sudo nginx 2>&1; then
  log "ERROR: Failed to start nginx daemon"
  exit 1
fi

log "✓ nginx daemon started"

# STEP 7: Verify nginx is actually listening on port 80 (BLOCKING)
log "Step 7: Verifying nginx is listening on port 80 (with retries)"

NGINX_READY=0
RETRY_COUNT=0
MAX_RETRIES=10
RETRY_DELAY=1

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  # Try multiple detection methods
  if netstat -tuln 2>/dev/null | grep -q ":80 " || \
     lsof -i :80 2>/dev/null | grep -q nginx || \
     curl -s http://127.0.0.1 > /dev/null 2>&1; then
    NGINX_READY=1
    break
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))
  log "  Waiting for nginx to bind port 80... (attempt $RETRY_COUNT/$MAX_RETRIES)"
  sleep $RETRY_DELAY
done

if [ $NGINX_READY -eq 0 ]; then
  log "ERROR: nginx did not bind to port 80 after $MAX_RETRIES attempts"
  log "  DEBUG: nginx processes:"
  ps aux | grep nginx | grep -v grep | while read line; do log "    $line"; done
  log "  DEBUG: netstat output:"
  netstat -tuln 2>/dev/null | grep -E ":(80|443)" | while read line; do log "    $line"; done
  exit 1
fi

log "✓ nginx listening on port 80"

# STEP 8: Verify htpasswd is accessible via HTTP
log "Step 8: Verifying HTTP Basic Auth is working"

# Test protected endpoint (should return 401 or 503, not 500)
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/ 2>&1)
if [ "$HTTP_STATUS" != "401" ] && [ "$HTTP_STATUS" != "503" ]; then
  log "WARNING: HTTP Basic Auth may not be configured correctly (got $HTTP_STATUS, expected 401 or 503)"
else
  log "✓ HTTP Basic Auth configured (status: $HTTP_STATUS)"
fi

# Test /desk endpoint (should be accessible without auth, return 200 or 404)
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/desk/ 2>&1)
if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "404" ]; then
  log "✓ /desk endpoint accessible without auth (status: $HTTP_STATUS)"
else
  log "WARNING: /desk endpoint returned unexpected status: $HTTP_STATUS"
fi

# Export PASSWORD for downstream use
export PASSWORD

log "✓ nginx setup complete and verified"
log "===== NGINX PHASE 0 BLOCKING COMPLETE ====="
log ""

exit 0
