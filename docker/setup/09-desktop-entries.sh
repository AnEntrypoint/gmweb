#!/bin/bash
# Setup: XFCE4 desktop application launchers
set -e

echo "Setting up desktop entries..."

# Terminal launcher
printf '[Desktop Entry]\nType=Application\nName=Terminal\nExec=/usr/bin/xfce4-terminal\nOnlyShowIn=XFCE;\n' > /home/kasm-user/.config/autostart/terminal.desktop

# Chromium launcher
printf '[Desktop Entry]\nType=Application\nName=Chromium\nExec=/usr/bin/chromium\nOnlyShowIn=XFCE;\n' > /home/kasm-user/.config/autostart/chromium.desktop

# Chrome Extension Installer
printf '[Desktop Entry]\nType=Application\nName=Chrome Extension Installer\nExec=/usr/local/nvm/versions/node/v23.11.1/bin/npx -y gxe@latest AnEntrypoint/chromeextensioninstaller chromeextensioninstaller jfeammnjpkecdekppnclgkkffahnhfhe\nOnlyShowIn=XFCE;\n' > /home/kasm-user/.config/autostart/ext.desktop

# Set permissions
chmod 644 /home/kasm-user/.config/autostart/*.desktop
chown -R kasm-user:kasm-user /home/kasm-user/.config/autostart

echo "Desktop entries setup complete"
