#!/bin/bash
# Setup: Node.js and NVM
set -e

echo "Setting up Node.js and NVM..."

export NVM_DIR=/usr/local/local/nvm
mkdir -p $NVM_DIR

# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Install Node.js
bash -c ". $NVM_DIR/nvm.sh && nvm install 23.11.1 && nvm use 23.11.1 && nvm alias default 23.11.1"

# Set PATH for build-time use
export PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin:$PATH"

echo "Node.js setup complete"
