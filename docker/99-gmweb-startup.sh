#!/bin/bash
# LinuxServer init script - executes GMWeb custom_startup.sh
# Follows https://docs.linuxserver.io/general/container-customization/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[gmweb-init] GMWeb initialization starting at $(date)"

# Try to find and execute custom_startup.sh in same directory or /tmp
if [ -f "$SCRIPT_DIR/custom_startup.sh" ]; then
  echo "[gmweb-init] Found custom_startup.sh at $SCRIPT_DIR/custom_startup.sh, executing..."
  exec bash "$SCRIPT_DIR/custom_startup.sh"
elif [ -f /tmp/custom_startup.sh ]; then
  echo "[gmweb-init] Found custom_startup.sh at /tmp/custom_startup.sh, executing..."
  exec bash /tmp/custom_startup.sh
else
  echo "[gmweb-init] ERROR: custom_startup.sh not found"
  exit 1
fi
