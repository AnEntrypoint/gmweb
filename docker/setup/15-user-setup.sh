#!/bin/bash
# Setup: User directories and permissions
set -e

echo "Setting up user directories and permissions..."

# Create cache and temp directories BEFORE switching to USER 1000
mkdir -p /home/kasm-user/.cache /home/kasm-user/.tmp
chown -R kasm-user:kasm-user /home/kasm-user/.cache /home/kasm-user/.tmp

# Set directory permissions
chmod a+rw /home/kasm-user -R
chown -R 1000:1000 /home/kasm-user

echo "User setup complete"
