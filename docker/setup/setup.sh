#!/bin/bash
# Master setup script - orchestrates all modular setup scripts
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETUP_SCRIPTS=(
    "01-system-packages.sh"
    "02-nodejs.sh"
    "03-github-cli.sh"
    "04-ssh.sh"
    "05-tmux.sh"
    "06-home-directory.sh"
    "07-webssh2.sh"
    "08-file-manager.sh"
    "09-desktop-entries.sh"
    "10-xfce4-terminal.sh"
    "11-chromium.sh"
    "12-chromium-extension.sh"
    "13-proxypilot.sh"
    "14-npm-globals.sh"
    "15-user-setup.sh"
)

echo "=========================================="
echo "gmweb Modular Setup System"
echo "=========================================="

for script in "${SETUP_SCRIPTS[@]}"; do
    script_path="$SCRIPT_DIR/$script"
    if [ ! -f "$script_path" ]; then
        echo "ERROR: Setup script not found: $script_path"
        exit 1
    fi
    
    echo ""
    echo "Running: $script"
    echo "------------------------------------------"
    bash "$script_path" || {
        echo "ERROR: $script failed with exit code $?"
        exit 1
    }
done

echo ""
echo "=========================================="
echo "All setup scripts completed successfully"
echo "=========================================="
