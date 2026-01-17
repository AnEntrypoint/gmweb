#!/bin/bash
# Setup: WebSSH2 (web-based SSH client)
set -e

echo "Setting up WebSSH2..."

export WEBSSH2_LISTEN_PORT=9999
git clone https://github.com/billchurch/webssh2.git /home/kasm-user/webssh2
cd /home/kasm-user/webssh2 && npm install --production
chown -R kasm-user:kasm-user /home/kasm-user/webssh2

echo "WebSSH2 setup complete"
