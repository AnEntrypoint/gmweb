# syntax=docker/dockerfile:1.4
# ULTRA-MINIMAL gmweb Dockerfile
# Only: Base image, NVM, Node.js, startup scripts
# All installation delegated to install.sh (called on first boot)
# ALL SETUP now happens in custom_startup.sh -> install.sh

ARG ARCH=aarch64
FROM kasmweb/ubuntu-noble-dind-rootless:${ARCH}-1.18.0

USER root
ENV DEBIAN_FRONTEND=noninteractive

# Minimal base: only git (needed for cloning gmweb repo)
RUN apt update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Setup NVM and Node.js (stable, pinned version)
ENV NVM_DIR=/usr/local/local/nvm
RUN mkdir -p $NVM_DIR && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && \
    bash -c ". $NVM_DIR/nvm.sh && nvm install 23.11.1 && nvm use 23.11.1 && nvm alias default 23.11.1"

# Set PATH for build and runtime
ENV PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin:$PATH"

# Clone gmweb repo to get startup system and custom startup hook
RUN git clone https://github.com/AnEntrypoint/gmweb.git /tmp/gmweb && \
    cp -r /tmp/gmweb/startup /opt/gmweb-startup && \
    cp /tmp/gmweb/docker/custom_startup.sh /dockerstartup/custom_startup.sh && \
    rm -rf /tmp/gmweb

# Setup startup system (in /opt, system-level, not user home)
RUN cd /opt/gmweb-startup && \
    npm install --production && \
    chmod +x /opt/gmweb-startup/install.sh && \
    chmod +x /opt/gmweb-startup/start.sh && \
    chmod +x /opt/gmweb-startup/index.js

# RUN install.sh at BUILD TIME (installs all system packages and software)
RUN bash /opt/gmweb-startup/install.sh

# Setup custom startup hook permissions
RUN chmod +x /dockerstartup/custom_startup.sh

# NOTE: KasmWeb natively manages /home/kasm-user and /home/kasm-default-profile
# Do NOT pre-create directories or modify these paths
# KasmWeb profile initialization handles everything automatically
# Our job: provide system-level software (/opt, /usr, /etc) only
# User-specific setup: handled by custom_startup.sh after KasmWeb initializes

# Switch to user (kasm-user = UID 1000)
USER 1000
