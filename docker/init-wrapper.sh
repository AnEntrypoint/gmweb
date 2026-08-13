#!/bin/bash
# LinuxServer init wrapper - executes custom_startup.sh
# This script is placed in /custom-cont-init.d/ to be run by LinuxServer's init system

set -e

# Check if custom_startup.sh was mounted to /tmp (docker-compose approach)
if [ -f /tmp/custom_startup.sh ]; then
  echo "[init-wrapper] Found /tmp/custom_startup.sh, executing..."
  chmod +x /tmp/custom_startup.sh
  exec bash /tmp/custom_startup.sh
fi

# Fallback: Check if custom_startup.sh exists in the same directory (Dockerfile approach)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/custom_startup.sh" ]; then
  echo "[init-wrapper] Found $SCRIPT_DIR/custom_startup.sh, executing..."
  exec bash "$SCRIPT_DIR/custom_startup.sh"
fi

# Last resort: Download from GitHub
echo "[init-wrapper] Downloading custom_startup.sh from GitHub..."
if curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gmweb/main/docker/custom_startup.sh -o /tmp/custom_startup.sh; then
  chmod +x /tmp/custom_startup.sh
  exec bash /tmp/custom_startup.sh
else
  echo "[init-wrapper] ERROR: Could not find or download custom_startup.sh"
  exit 1
fi
