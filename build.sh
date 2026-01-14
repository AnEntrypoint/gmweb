#!/bin/bash
# Auto-detect system architecture and build Docker image

set -e

# Detect host architecture
ARCH=$(uname -m)

case "$ARCH" in
  x86_64|amd64)
    BUILD_ARCH="x86_64"
    echo "✓ Detected x86_64 architecture"
    ;;
  aarch64|arm64)
    BUILD_ARCH="aarch64"
    echo "✓ Detected aarch64 architecture"
    ;;
  *)
    echo "✗ Unknown architecture: $ARCH"
    echo "Supported: x86_64, aarch64"
    exit 1
    ;;
esac

echo "Building gmweb for $BUILD_ARCH..."
docker-compose build --build-arg ARCH="$BUILD_ARCH" "$@"
echo "✓ Build complete for $BUILD_ARCH"
