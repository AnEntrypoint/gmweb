#!/bin/bash
set -e

uid=${1:-1000}
gid=${2:-1000}
runtime_dir="/run/user/$uid"

mkdir -p "$runtime_dir"
chmod 700 "$runtime_dir"
chown "$uid:$gid" "$runtime_dir"

export XDG_RUNTIME_DIR="$runtime_dir"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime_dir/bus"

if [ ! -S "$runtime_dir/bus" ]; then
  sudo -u $(id -un $uid) DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime_dir/bus" \
    dbus-daemon --session --address=unix:path=$runtime_dir/bus --nofork --print-address 2>/dev/null &

  DBUS_PID=$!
  sleep 1

  if ! kill -0 $DBUS_PID 2>/dev/null; then
    exit 1
  fi
fi

echo "$DBUS_SESSION_BUS_ADDRESS"
