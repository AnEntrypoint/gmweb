#!/bin/bash
# Setup: tmux configuration
set -e

echo "Setting up tmux..."

# Global tmux config
printf 'set -g history-limit 2000\nset -g terminal-overrides "xterm*:smcup@:rmcup@"\nset-option -g allow-rename off\nset-option -g set-titles on\n' > /etc/tmux.conf

# User tmux config
mkdir -p /home/kasm-user/.tmux
printf 'set -g history-limit 2000\nset -g terminal-overrides "xterm*:smcup@:rmcup@"\nset-option -g allow-rename off\n' > /home/kasm-user/.tmux.conf
chown kasm-user:kasm-user /home/kasm-user/.tmux.conf

echo "tmux setup complete"
