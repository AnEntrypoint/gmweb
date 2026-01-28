#!/bin/bash

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

if [ ! -d "$XDG_RUNTIME_DIR" ]; then
  mkdir -p "$XDG_RUNTIME_DIR"
  chmod 700 "$XDG_RUNTIME_DIR"
fi

if [ ! -S "$XDG_RUNTIME_DIR/bus" ]; then
  mkdir -p "$XDG_RUNTIME_DIR"
  dbus-daemon --session --address="unix:path=$XDG_RUNTIME_DIR/bus" --nofork --print-address &
  DBUS_PID=$!
  sleep 1

  if ! kill -0 $DBUS_PID 2>/dev/null; then
    exec "$@"
  fi
fi

exec "$@"
