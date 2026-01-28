#!/bin/bash
# gmweb Installation Script - SYSTEM PACKAGES ONLY
# Runs ONCE during docker build time (RUN bash install.sh in Dockerfile)
# DO NOT create anything in /config - LinuxServer webtop manages that at startup
# Idempotent checks NOT needed (runs only once)
# All output captured by docker build

set -e

# LinuxServer webtop uses 'abc' as the default user
WEBTOP_USER="abc"

log() {
  echo "[gmweb-install] $@"
}

log "===== GMWEB INSTALL START $(date) ====="

# ============================================================================
# 1. SYSTEM PACKAGES (apt-get)
# ============================================================================

log "Installing system packages..."

# Ensure apt is functional
echo "${WEBTOP_USER} ALL=(ALL) NOPASSWD: ALL" | sudo tee -a /etc/sudoers > /dev/null
sudo apt --fix-broken install -y 2>/dev/null || true
sudo dpkg --configure -a 2>/dev/null || true
sudo apt update

# Install packages (including scrot for screenshots, xclip for tmux clipboard)
sudo apt-get install -y --no-install-recommends \
  curl bash git build-essential ca-certificates jq wget \
  software-properties-common apt-transport-https gnupg openssh-server \
  openssh-client tmux lsof chromium chromium-sandbox xfce4-terminal xfce4 dbus-x11 \
  scrot xclip \
  libgbm1 libgtk-3-0 libnss3 libxss1 libasound2 libatk-bridge2.0-0 \
  libdrm2 libxcomposite1 libxdamage1 libxrandr2

sudo rm -rf /var/lib/apt/lists/*
log "✓ System packages installed"

# ============================================================================
# 2. SSH CONFIGURATION
# ============================================================================

log "Configuring SSH..."

sudo mkdir -p /run/sshd

# Enable password authentication
sudo sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config || true
sudo sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config || true
if ! grep -q '^PasswordAuthentication yes' /etc/ssh/sshd_config; then
  sudo bash -c 'echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config'
fi

# Enable pubkey authentication
sudo sed -i 's/^#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config || true

# Disable PAM
sudo sed -i 's/^UsePAM yes/UsePAM no/' /etc/ssh/sshd_config || true
if ! grep -q '^UsePAM no' /etc/ssh/sshd_config; then
  sudo bash -c 'echo "UsePAM no" >> /etc/ssh/sshd_config'
fi

# Generate host keys
sudo /usr/bin/ssh-keygen -A

# Set default password for webtop user
echo "${WEBTOP_USER}:abc" | sudo chpasswd

log "✓ SSH configured"

# ============================================================================
# 3. GITHUB CLI
# ============================================================================

log "Installing GitHub CLI..."

curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update
sudo apt-get install -y --no-install-recommends gh
sudo rm -rf /var/lib/apt/lists/*

log "✓ GitHub CLI installed"

# ============================================================================
# 4. TMUX CONFIGURATION
# ============================================================================

log "Configuring tmux..."

# Global tmux.conf (system-wide)
sudo printf 'set -g history-limit 2000\nset -g terminal-overrides "xterm*:smcup@:rmcup@"\nset-option -g allow-rename off\nset-option -g set-titles on\n' | sudo tee /etc/tmux.conf > /dev/null

# User tmux.conf will be created in custom_startup.sh at boot
log "✓ Global tmux configured (user config at boot time)"

# ============================================================================
# NOTE: USER HOME SETUP REMOVED
# ============================================================================
# No user home files created at build time
# All setup deferred to allow KasmWeb profile initialization
# User-specific files should be created by supervisor on second boot

# ============================================================================
# 10. PROXYPILOT DOWNLOAD
# ============================================================================

log "Downloading ProxyPilot..."

ARCH=$(uname -m)
TARGETARCH=$([ "$ARCH" = "x86_64" ] && echo "amd64" || echo "arm64")

# Try to get download URL from GitHub API
DOWNLOAD_URL=$(curl -s https://api.github.com/repos/Finesssee/ProxyPilot/releases/latest | \
  jq -r ".assets[] | select(.name | contains(\"linux-${TARGETARCH}\")) | .browser_download_url" | head -1)

# Fallback to direct URL pattern if API fails
if [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
  log "GitHub API failed, trying direct download..."
  DOWNLOAD_URL="https://github.com/Finesssee/ProxyPilot/releases/latest/download/proxypilot-linux-${TARGETARCH}"
fi

log "Downloading from: $DOWNLOAD_URL"
if curl -fL -o /tmp/proxypilot "$DOWNLOAD_URL" 2>/dev/null; then
  sudo mv /tmp/proxypilot /usr/bin/proxypilot
  sudo chmod +x /usr/bin/proxypilot
  log "✓ ProxyPilot installed"
else
  log "WARNING: ProxyPilot download failed - service will be unavailable"
fi

# Download ProxyPilot config.yaml to /opt (user home not available at build time)
log "Downloading ProxyPilot config..."
if curl -fL -o /opt/proxypilot-config.yaml https://raw.githubusercontent.com/Finesssee/ProxyPilot/refs/heads/main/config.example.yaml 2>/dev/null; then
  log "✓ ProxyPilot config.yaml downloaded to /opt (copied to user home at boot)"
else
  log "WARNING: ProxyPilot config.yaml download failed"
fi

# ============================================================================
# 10b. CHROMIUM EXTENSION POLICIES
# ============================================================================

log "Setting up Chromium extension policies..."

sudo mkdir -p /etc/chromium/policies/managed
echo '{"ExtensionInstallForcelist": ["jfeammnjpkecdekppnclgkkffahnhfhe;https://clients2.google.com/service/update2/crx"]}' | sudo tee /etc/chromium/policies/managed/extension_install_forcelist.json > /dev/null
sudo mkdir -p /opt/google/chrome/extensions
sudo chmod 777 /opt/google/chrome/extensions

log "✓ Chromium extension policies configured"

# ============================================================================
# 10c. CHROMIUM EXTENSION ENABLER SCRIPT
# ============================================================================

log "Creating Chromium extension enabler script..."

sudo tee /usr/local/bin/enable_chromium_extension.py > /dev/null << 'PYEOF'
#!/usr/bin/env python3
import json, os, sys
prefs_file = os.path.expanduser("~/.config/chromium/Default/Preferences")
os.makedirs(os.path.dirname(prefs_file), exist_ok=True)
try:
    if os.path.exists(prefs_file):
        with open(prefs_file) as f: prefs = json.load(f)
    else:
        prefs = {}
    prefs.setdefault("extensions", {}).setdefault("settings", {}).setdefault("jfeammnjpkecdekppnclgkkffahnhfhe", {})["active_bit"] = True
    with open(prefs_file, "w") as f: json.dump(prefs, f)
except Exception as e: 
    print(f"Error: {e}", file=sys.stderr)
PYEOF
sudo chmod +x /usr/local/bin/enable_chromium_extension.py

log "✓ Chromium extension enabler script created"

# ============================================================================
# 10d. CHROMIUM NO-SANDBOX WRAPPER
# ============================================================================

log "Creating Chromium no-sandbox wrapper..."

# Backup original chromium binary
sudo mv /usr/bin/chromium /usr/bin/chromium.real

# Create wrapper script that adds --no-sandbox flag
sudo tee /usr/bin/chromium > /dev/null << 'CHROMIUM_WRAPPER'
#!/bin/sh
# Chromium wrapper to add --no-sandbox flag for Docker/container environments
# This is necessary because unprivileged user namespaces are disabled
exec /usr/bin/chromium.real --no-sandbox "$@"
CHROMIUM_WRAPPER

sudo chmod +x /usr/bin/chromium

log "✓ Chromium no-sandbox wrapper created"

# ============================================================================
# 10e. CHROMIUM AUTOSTART ENTRY
# ============================================================================

log "Creating Chromium autostart desktop entry..."

# Note: Desktop entry will be created at first boot when user directories exist
# Store the entry content in a file for later creation
cat > /opt/gmweb-startup/chromium-autostart.desktop << 'AUTOSTART_EOF'
[Desktop Entry]
Type=Application
Name=Chromium
Comment=Open Chromium with Playwriter Extension Debugger
Icon=chromium
Exec=chromium --app="chrome-extension://jfeammnjpkecdekppnclgkkffahnhfhe/index.html" --window-size=800,600 http://localhost/
Categories=Network;WebBrowser;
X-GNOME-Autostart-enabled=true
AUTOSTART_EOF

log "✓ Chromium autostart entry template stored (will be installed on first boot)"

# ============================================================================
# 11. TTYD WEB TERMINAL
# ============================================================================

log "Downloading ttyd (web terminal)..."

ARCH=$(uname -m)
TTYD_ARCH=$([ "$ARCH" = "x86_64" ] && echo "x86_64" || echo "aarch64")

TTYD_URL="https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.${TTYD_ARCH}"
log "Downloading ttyd from: $TTYD_URL"

TTYD_RETRY=3
TTYD_DOWNLOADED=0
while [ $TTYD_RETRY -gt 0 ] && [ $TTYD_DOWNLOADED -eq 0 ]; do
  if timeout 60 curl -fL --max-redirs 5 -o /tmp/ttyd "$TTYD_URL" 2>/dev/null && [ -f /tmp/ttyd ] && [ -s /tmp/ttyd ]; then
    TTYD_DOWNLOADED=1
  else
    TTYD_RETRY=$((TTYD_RETRY - 1))
    if [ $TTYD_RETRY -gt 0 ]; then
      log "ttyd download attempt failed, retrying ($TTYD_RETRY left)..."
      sleep 5
    fi
  fi
done

if [ $TTYD_DOWNLOADED -eq 1 ]; then
  sudo mv /tmp/ttyd /usr/bin/ttyd
  sudo chmod +x /usr/bin/ttyd
  log "✓ ttyd installed"
else
  log "WARNING: ttyd download failed after retries - webssh2 will be unavailable"
  rm -f /tmp/ttyd
fi

# ============================================================================
# 12. PERMISSIONS (moved to custom_startup.sh)
# ============================================================================

log "Permissions are set at boot time by custom_startup.sh"

# ============================================================================
# 14. NHFS PRE-BUILDING
# ============================================================================

log "NHFS will be run via npx at startup (no pre-build needed)"
log "✓ NHFS HTTP file server ready to launch"

# ============================================================================
# 15. INSTALL NPM PACKAGES FOR GLOBAL USE
# ============================================================================

log "Installing global npm packages..."

npm install -g better-sqlite3 2>&1 | tail -3
log "better-sqlite3 installed"

mkdir -p /config/node_modules
cd /config && npm install bcrypt 2>&1 | tail -3
log "bcrypt installed"

npm install -g agent-browser 2>&1 | tail -3
agent-browser install --with-deps 2>&1 | tail -5
log "agent-browser installed"

# ============================================================================
# COMPLETION
# ============================================================================

log "===== GMWEB INSTALL COMPLETE $(date) ====="
exit 0
