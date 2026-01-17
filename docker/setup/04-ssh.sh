#!/bin/bash
# Setup: SSH daemon with password authentication
set -e

echo "Setting up SSH..."

mkdir -p /run/sshd

# Enable password authentication
sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config
grep -q '^PasswordAuthentication yes' /etc/ssh/sshd_config || echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config

# Enable public key authentication
sed -i 's/^#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# Disable PAM
sed -i 's/^UsePAM yes/UsePAM no/' /etc/ssh/sshd_config
grep -q '^UsePAM no' /etc/ssh/sshd_config || echo 'UsePAM no' >> /etc/ssh/sshd_config

# Generate keys
/usr/bin/ssh-keygen -A

# Set default password
echo 'kasm-user:kasm' | chpasswd

echo "SSH setup complete"
