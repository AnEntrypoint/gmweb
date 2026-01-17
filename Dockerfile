# syntax=docker/dockerfile:1.4
# ULTRA-MINIMAL gmweb Dockerfile
# Only: Base image, NVM, Node.js, startup scripts
# All installation delegated to install.sh (called on first boot)
# ALL SETUP now happens in custom_startup.sh -> install.sh

ARG ARCH=aarch64
FROM kasmweb/ubuntu-noble-dind-rootless:${ARCH}-1.18.0

USER root
ENV DEBIAN_FRONTEND=noninteractive

# Minimal base: only git (needed for cloning repos in install.sh)
RUN apt update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Setup NVM and Node.js (stable, pinned version)
ENV NVM_DIR=/usr/local/local/nvm
RUN mkdir -p $NVM_DIR && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && \
    bash -c ". $NVM_DIR/nvm.sh && nvm install 23.11.1 && nvm use 23.11.1 && nvm alias default 23.11.1"

# Set PATH for build and runtime
ENV PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin:$PATH"

# Copy modular startup system to image
COPY startup/ /home/kasm-user/gmweb-startup/
RUN cd /home/kasm-user/gmweb-startup && \
    npm install --production && \
    chmod +x /home/kasm-user/gmweb-startup/install.sh && \
    chmod +x /home/kasm-user/gmweb-startup/start.sh && \
    chmod +x /home/kasm-user/gmweb-startup/index.js && \
    chown -R 1000:1000 /home/kasm-user/gmweb-startup

# RUN install.sh at BUILD TIME (installs all system packages and software)
RUN bash /home/kasm-user/gmweb-startup/install.sh

# Copy KasmWeb custom startup hook (orchestrator for start.sh + user hook)
COPY docker/custom_startup.sh /dockerstartup/custom_startup.sh
RUN chmod +x /dockerstartup/custom_startup.sh

# Switch to user (kasm-user = UID 1000)
USER 1000
