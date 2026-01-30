#!/bin/bash
# LinuxServer init shim - mounts to /etc/cont-init.d/ or /custom-cont-init.d/
# Executes custom_startup.sh from mounted location or downloads from GitHub

set -e

echo "[init-shim] GMWeb startup shim starting..."

# Try multiple locations for custom_startup.sh
if [ -f /tmp/gmweb/custom_startup.sh ]; then
  echo "[init-shim] Found custom_startup.sh at /tmp/gmweb/custom_startup.sh"
  exec bash /tmp/gmweb/custom_startup.sh
elif [ -f /tmp/custom_startup.sh ]; then
  echo "[init-shim] Found custom_startup.sh at /tmp/custom_startup.sh"
  exec bash /tmp/custom_startup.sh
elif [ -f /docker/custom_startup.sh ]; then
  echo "[init-shim] Found custom_startup.sh at /docker/custom_startup.sh"
  exec bash /docker/custom_startup.sh
else
  # Download from GitHub as last resort
  echo "[init-shim] Downloading custom_startup.sh from GitHub..."
  mkdir -p /tmp/gmweb
  if curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gmweb/main/docker/custom_startup.sh -o /tmp/gmweb/custom_startup.sh; then
    chmod +x /tmp/gmweb/custom_startup.sh
    exec bash /tmp/gmweb/custom_startup.sh
  else
    echo "[init-shim] ERROR: Could not find or download custom_startup.sh"
    exit 1
  fi
fi
