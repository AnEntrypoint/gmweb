#!/bin/bash
# Setup: XFCE4 Terminal configuration
set -e

echo "Setting up XFCE4 Terminal..."

printf '<?xml version="1.0" encoding="UTF-8"?>\n\n<channel name="xfce4-terminal" version="1.0">\n  <property name="font-name" type="string" value="Monospace 9"/>\n</channel>\n' > /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-terminal.xml

chown -R kasm-user:kasm-user /home/kasm-user/.config/xfce4
chmod 644 /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-terminal.xml

echo "XFCE4 Terminal setup complete"
