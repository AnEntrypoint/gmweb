#!/bin/bash
# gmweb Installation Script - ALL setup steps
# Runs ONCE during docker build time (RUN bash install.sh in Dockerfile)
# Idempotent checks NOT needed (runs only once)
# All output captured by docker build

set -e

LOG_DIR="/home/kasm-user/logs"
mkdir -p "$LOG_DIR"

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

# Install packages
sudo apt-get install -y --no-install-recommends \
  curl bash git build-essential ca-certificates jq wget \
  software-properties-common apt-transport-https gnupg openssh-server \
  openssh-client tmux lsof chromium xfce4-terminal xfce4 dbus-x11

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

# Global tmux.conf
sudo printf 'set -g history-limit 2000\nset -g terminal-overrides "xterm*:smcup@:rmcup@"\nset-option -g allow-rename off\nset-option -g set-titles on\n' | sudo tee /etc/tmux.conf > /dev/null

# User tmux.conf
mkdir -p ~/.tmux
printf 'set -g history-limit 2000\nset -g terminal-overrides "xterm*:smcup@:rmcup@"\nset-option -g allow-rename off\n' > ~/.tmux.conf

log "✓ tmux configured"

# ============================================================================
# 5. HOME DIRECTORY STRUCTURE
# ============================================================================

log "Setting up home directory structure..."

# Create directories (do NOT create Desktop/Downloads - KasmWeb creates it as symlink)
mkdir -p ~/Desktop/Uploads
mkdir -p ~/Downloads
mkdir -p ~/.config/autostart
mkdir -p ~/.config/xfce4/xfconf/xfce-perchannel-xml
mkdir -p ~/logs

# Ensure proper permissions for KasmWeb to create symlinks
chmod 755 ~/Desktop
chmod 755 ~/Downloads

log "✓ Home directories created"

# ============================================================================
# 6. XFCE4 TERMINAL CONFIGURATION
# ============================================================================

log "Configuring XFCE4 Terminal..."

printf '<?xml version="1.0" encoding="UTF-8"?>\n\n<channel name="xfce4-terminal" version="1.0">\n  <property name="font-name" type="string" value="Monospace 9"/>\n</channel>\n' > ~/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-terminal.xml
chmod 644 ~/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-terminal.xml

log "✓ XFCE4 Terminal configured"

# ============================================================================
# 7. XFCE4 DESKTOP ENTRIES
# ============================================================================

log "Creating XFCE4 desktop entries..."

# Terminal entry
printf '[Desktop Entry]\nType=Application\nName=Terminal\nExec=/usr/bin/xfce4-terminal\nOnlyShowIn=XFCE;\n' > ~/.config/autostart/terminal.desktop

# Chromium entry
printf '[Desktop Entry]\nType=Application\nName=Chromium\nExec=/usr/bin/chromium\nOnlyShowIn=XFCE;\n' > ~/.config/autostart/chromium.desktop

# Chrome Extension Installer entry
printf '[Desktop Entry]\nType=Application\nName=Chrome Extension Installer\nExec=bash -c "chromium --install-extension=cnobjgjejhbkcjbakdkdkhchpijecafo"\nOnlyShowIn=XFCE;\n' > ~/.config/autostart/ext.desktop

chmod 644 ~/.config/autostart/*.desktop

log "✓ Desktop entries created"

# ============================================================================
# 8. WEBSSH2 SETUP
# ============================================================================

log "Setting up WebSSH2..."

if [ ! -d ~/webssh2 ]; then
  git clone https://github.com/billchurch/webssh2.git ~/webssh2
fi

cd ~/webssh2
npm install --production
cd -

log "✓ WebSSH2 installed"

# ============================================================================
# 9. FILE MANAGER SETUP
# ============================================================================

log "Setting up File Manager..."

if [ ! -d ~/node-file-manager-esm ]; then
  git clone https://github.com/BananaAcid/node-file-manager-esm.git ~/node-file-manager-esm
fi

cd ~/node-file-manager-esm
npm install --production
cd -

log "✓ File Manager installed"

# ============================================================================
# 10. PROXYPILOT DOWNLOAD
# ============================================================================

log "Downloading ProxyPilot..."

ARCH=$(uname -m)
TARGETARCH=$([ "$ARCH" = "x86_64" ] && echo "amd64" || echo "arm64")

DOWNLOAD_URL=$(curl -s https://api.github.com/repos/Finesssee/ProxyPilot/releases/latest | \
  grep "proxypilot-linux-${TARGETARCH}" | \
  grep -o '"browser_download_url": "[^"]*"' | \
  cut -d'"' -f4 | head -1)

if [ -z "$DOWNLOAD_URL" ]; then
  log "WARNING: Could not determine ProxyPilot download URL"
else
  curl -L -o /tmp/proxypilot "$DOWNLOAD_URL"
  sudo mv /tmp/proxypilot /usr/bin/proxypilot
  sudo chmod +x /usr/bin/proxypilot
  log "✓ ProxyPilot installed"
fi

# ============================================================================
# 11. COMPREHENSIVE PERMISSIONS FIX
# ============================================================================

log "Setting comprehensive permissions..."

# Ensure all home directories properly owned
sudo chown -R kasm-user:kasm-user /home/kasm-user

# Set directory permissions (755 = rwxr-xr-x, 600 = rw-------)
chmod 755 /home/kasm-user{,/.config,/.config/{autostart,xfce4,xfce4/xfconf,xfce4/xfconf/xfce-perchannel-xml},/Desktop,/Desktop/Uploads,/Downloads,/logs}
mkdir -p ~/.cache ~/.tmp
chmod 755 ~/.cache ~/.tmp
chmod 600 ~/.bashrc 2>/dev/null || true
chmod 644 ~/.config/autostart/*.desktop 2>/dev/null || true

# Fix permissions recursively on service directories
find ~/{webssh2,node-file-manager-esm} -type d 2>/dev/null -exec chmod 755 {} \;

log "✓ Permissions normalized"

# ============================================================================
# 12. .bashrc ENVIRONMENT SETUP
# ============================================================================

log "Adding environment variables to .bashrc..."

if ! grep -q "GMWeb Environment Setup" ~/.bashrc 2>/dev/null; then
  cat >> ~/.bashrc <<'BASHRC_EOF'

# GMWeb Environment Setup
export NVM_DIR="/usr/local/local/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"

export NODE_PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin"
export PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin:$PATH"
export PATH="$HOME/.local/bin:$PATH"

export WEBSSH2_LISTEN_PORT=9999
export PORT=9998

# Auto-attach to tmux
if [ -z "$TMUX" ] && [ -z "$SSH_CONNECTION" ]; then
  exec tmux attach-session -t main 2>/dev/null || exec tmux new-session -s main
fi
BASHRC_EOF
  log "✓ Environment variables added to .bashrc"
fi

# ============================================================================
# COMPLETION
# ============================================================================

log "===== GMWEB INSTALL COMPLETE $(date) ====="
exit 0
