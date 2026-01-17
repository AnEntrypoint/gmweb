#!/bin/bash
# Setup: System packages and apt configuration
set -e

echo "Setting up system packages..."

# Fix broken installations
apt --fix-broken install
dpkg --configure -a
apt update

# Install base system packages
apt-get install -y --no-install-recommends \
    curl bash git build-essential ca-certificates jq wget \
    software-properties-common apt-transport-https gnupg \
    openssh-server openssh-client tmux

# Cleanup
rm -rf /var/lib/apt/lists/*

echo "System packages setup complete"
