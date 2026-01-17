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
  cd -
  log "✓ Claude Code UI installed"
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
