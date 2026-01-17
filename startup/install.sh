#!/bin/bash
# gmweb Installation Script - SYSTEM PACKAGES ONLY
# Runs ONCE during docker build time (RUN bash install.sh in Dockerfile)
# DO NOT create anything in /home/kasm-user - KasmWeb manages that at startup
# Idempotent checks NOT needed (runs only once)
# All output captured by docker build

set -e

log() {
  echo "[gmweb-install] $@"
}

log "===== GMWEB INSTALL START $(date) ====="

# ============================================================================
# 1. SYSTEM PACKAGES (apt-get)
# ============================================================================

log "Installing system packages..."

# Ensure apt is functional
echo "kasm-user ALL=(ALL) NOPASSWD: ALL" | sudo tee -a /etc/sudoers > /dev/null
sudo apt --fix-broken install -y 2>/dev/null || true
sudo dpkg --configure -a 2>/dev/null || true
sudo apt update

# Install packages (including scrot for screenshots)
sudo apt-get install -y --no-install-recommends \
  curl bash git build-essential ca-certificates jq wget \
  software-properties-common apt-transport-https gnupg openssh-server \
  openssh-client tmux lsof chromium xfce4-terminal xfce4 dbus-x11 \
  scrot

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

# Set default password for kasm-user
echo 'kasm-user:kasm' | sudo chpasswd

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

# Download ProxyPilot config.yaml
log "Downloading ProxyPilot config..."
if curl -fL -o /home/kasm-user/config.yaml https://raw.githubusercontent.com/Finesssee/ProxyPilot/refs/heads/main/config.example.yaml 2>/dev/null; then
  log "✓ ProxyPilot config.yaml downloaded"
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
if os.path.exists(prefs_file):
    try:
        with open(prefs_file) as f: prefs = json.load(f)
        prefs.setdefault("extensions", {}).setdefault("settings", {}).setdefault("jfeammnjpkecdekppnclgkkffahnhfhe", {})["active_bit"] = True
        with open(prefs_file, "w") as f: json.dump(prefs, f)
    except: pass
PYEOF
sudo chmod +x /usr/local/bin/enable_chromium_extension.py

log "✓ Chromium extension enabler script created"

# ============================================================================
# 11. TTYD WEB TERMINAL
# ============================================================================

log "Downloading ttyd (web terminal)..."

ARCH=$(uname -m)
TTYD_ARCH=$([ "$ARCH" = "x86_64" ] && echo "x86_64" || echo "aarch64")

TTYD_URL="https://github.com/tsl0922/ttyd/releases/latest/download/ttyd.${TTYD_ARCH}"
log "Downloading ttyd from: $TTYD_URL"
if curl -fL -o /tmp/ttyd "$TTYD_URL" 2>/dev/null; then
  sudo mv /tmp/ttyd /usr/bin/ttyd
  sudo chmod +x /usr/bin/ttyd
  log "✓ ttyd installed"
else
  log "WARNING: ttyd download failed - web terminal will be unavailable"
fi

# ============================================================================
# 12. CLAUDE CODE UI
# ============================================================================

log "Installing Claude Code UI..."

if [ -d /opt/claudecodeui ]; then
  log "Claude Code UI already exists, skipping clone"
else
  git clone https://github.com/siteboon/claudecodeui /opt/claudecodeui
  cd /opt/claudecodeui
  npm install

  # Patch App.jsx to add basename detection for proxy routing support
  # When accessed via /ui prefix, React Router needs basename="/ui" to match routes
  log "Patching Claude Code UI for proxy basename support..."
  sed -i 's|// Root App component with router|// Detect basename from current URL path for proxy routing support\n// When accessed via /ui, the router needs basename="/ui" to match routes correctly\nfunction getBasename() {\n  const path = window.location.pathname;\n  if (path.startsWith("/ui")) return "/ui";\n  return "/";\n}\n\n// Root App component with router|' src/App.jsx
  sed -i 's|function App() {|function App() {\n  const basename = getBasename();|' src/App.jsx
  sed -i 's|<Router>|<Router basename={basename}>|' src/App.jsx
  log "✓ Claude Code UI patched for proxy support"

  npm run build
  cd -
  log "✓ Claude Code UI installed and built"
fi

# ============================================================================
# 13. PERMISSIONS (moved to custom_startup.sh)
# ============================================================================

log "Permissions are set at boot time by custom_startup.sh"

# ============================================================================
# COMPLETION
# ============================================================================

log "===== GMWEB INSTALL COMPLETE $(date) ====="
exit 0
