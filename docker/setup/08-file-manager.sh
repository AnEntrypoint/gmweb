#!/bin/bash
# Setup: Node File Manager (web-based file browser)
set -e

echo "Setting up File Manager..."

export PORT=9998
git clone https://github.com/BananaAcid/node-file-manager-esm.git /home/kasm-user/node-file-manager-esm
cd /home/kasm-user/node-file-manager-esm && npm install --production
chown -R kasm-user:kasm-user /home/kasm-user/node-file-manager-esm

echo "File Manager setup complete"
