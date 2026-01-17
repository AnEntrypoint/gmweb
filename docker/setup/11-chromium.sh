#!/bin/bash
# Setup: Chromium browser policies and extensions
set -e

echo "Setting up Chromium..."

# Create policies directory
mkdir -p /etc/chromium/policies/managed

# Set extension install policy
echo '{"ExtensionInstallForcelist": ["jfeammnjpkecdekppnclgkkffahnhfhe;https://clients2.google.com/service/update2/crx"]}' > /etc/chromium/policies/managed/extension_install_forcelist.json

# Create extensions directory
mkdir -p /opt/google/chrome/extensions
chmod 777 /opt/google/chrome/extensions

echo "Chromium setup complete"
