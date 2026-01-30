#!/bin/bash
set -e

echo "[gmweb-init] Downloading startup script from GitHub..."
if curl -fsSL https://raw.githubusercontent.com/AnEntrypoint/gmweb/main/startup.sh -o /tmp/gmweb-startup.sh 2>/dev/null; then
  chmod +x /tmp/gmweb-startup.sh
  bash /tmp/gmweb-startup.sh
else
  echo "[gmweb-init] ERROR: Failed to download startup.sh from GitHub"
  exit 1
fi
