#!/bin/bash
# Setup: Home directory structure
set -e

echo "Setting up home directory structure..."

mkdir -p /home/kasm-user/Desktop/Uploads
mkdir -p /home/kasm-user/.config/autostart
mkdir -p /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml
mkdir -p /home/kasm-user/logs

echo "Home directory setup complete"
