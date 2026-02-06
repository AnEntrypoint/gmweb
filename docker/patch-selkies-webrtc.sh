#!/bin/bash
# Patch Selkies s6-rc service to use WebRTC mode instead of WebSocket
# This enables more efficient low-latency streaming for desktop access
# Called from custom_startup.sh during Phase 0 before s6-rc services start

set +e

SELKIES_RUN="/etc/s6-overlay/s6-rc.d/svc-selkies/run"

if [ ! -f "$SELKIES_RUN" ]; then
  echo "[patch-selkies] ERROR: Selkies s6-rc service not found at $SELKIES_RUN"
  exit 1
fi

# Backup original (for debugging)
cp "$SELKIES_RUN" "$SELKIES_RUN.backup" 2>/dev/null || true

# Replace --mode="websockets" with --mode="webrtc"
sed -i 's/--mode="websockets"/--mode="webrtc"/g' "$SELKIES_RUN"

# Verify patch was applied
if grep -q '--mode="webrtc"' "$SELKIES_RUN"; then
  echo "[patch-selkies] ✓ Selkies patched to WebRTC mode"
  exit 0
else
  echo "[patch-selkies] ERROR: Failed to patch Selkies to WebRTC mode"
  exit 1
fi
