#!/bin/bash
# Setup: ProxyPilot network daemon
set -e

echo "Setting up ProxyPilot..."

ARCH=$(uname -m)
TARGETARCH=$([ "$ARCH" = "x86_64" ] && echo "amd64" || echo "arm64")

# Fetch latest release
DOWNLOAD_URL=$(curl -s https://api.github.com/repos/Finesssee/ProxyPilot/releases/latest | grep "proxypilot-linux-${TARGETARCH}" | grep -o '"browser_download_url": "[^"]*"' | cut -d'"' -f4 | head -1)

# Download and install
curl -L -o /usr/bin/proxypilot "$DOWNLOAD_URL"
chmod +x /usr/bin/proxypilot

# Download configuration
wget -nc -O /home/kasm-user/config.yaml https://raw.githubusercontent.com/Finesssee/ProxyPilot/refs/heads/main/config.example.yaml

echo "ProxyPilot setup complete"
