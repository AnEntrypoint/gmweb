# syntax=docker/dockerfile:1.4
# gmweb Dockerfile - LinuxServer Webtop base
# Ubuntu XFCE4 desktop with gmweb startup system

FROM lscr.io/linuxserver/webtop:ubuntu-xfce

# LinuxServer init will run scripts in /custom-cont-init.d/ at container start
# and services in /custom-services.d/ as supervised services

# Install minimal dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    lsof \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Setup NVM and Node.js (stable, pinned version)
ENV NVM_DIR=/usr/local/local/nvm
RUN mkdir -p $NVM_DIR && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && \
    bash -c ". $NVM_DIR/nvm.sh && nvm install 23.11.1 && nvm use 23.11.1 && nvm alias default 23.11.1"

# Set PATH for build and runtime
ENV PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin:$PATH"

# Cache-bust to force fresh git clone (ensures latest code from GitHub)
# CRITICAL: Increment this to force Docker rebuild when fixes are pushed
# Last updated: 2026-01-20 10:25:00 UTC - nginx startup order fixes
ARG BUILD_DATE=unknown
ARG CACHE_BUST=20260120-1

# Clone gmweb repo to get startup system (no depth limit to ensure latest commits)
RUN git clone https://github.com/AnEntrypoint/gmweb.git /tmp/gmweb && \
    cp -r /tmp/gmweb/startup /opt/gmweb-startup && \
    rm -rf /tmp/gmweb

# Copy custom startup script and nginx config BEFORE setup (needed by startup system)
COPY docker/custom_startup.sh /opt/gmweb-startup/custom_startup.sh
COPY docker/nginx-sites-enabled-default /opt/gmweb-startup/nginx-sites-enabled-default

# Setup startup system
RUN cd /opt/gmweb-startup && \
    npm install --production && \
    chmod +x /opt/gmweb-startup/install.sh && \
    chmod +x /opt/gmweb-startup/start.sh && \
    chmod +x /opt/gmweb-startup/index.js && \
    chmod +x /opt/gmweb-startup/custom_startup.sh

# RUN install.sh at BUILD TIME (installs all system packages and software)
RUN bash /opt/gmweb-startup/install.sh

# Pre-install nginx config to active location during build
# This ensures nginx starts with the correct config on first boot
# s6-rc may start nginx before custom_startup.sh runs, so we need this
RUN mkdir -p /etc/nginx/sites-enabled && \
    cp /opt/gmweb-startup/nginx-sites-enabled-default /etc/nginx/sites-enabled/default

# Configure sudo for abc user (needed for nginx reload and service management)
# Allow abc user to run /etc/init.d/nginx and pkill without password
RUN mkdir -p /etc/sudoers.d && \
    echo "abc ALL=(ALL) NOPASSWD: /etc/init.d/nginx" > /etc/sudoers.d/gmweb-nginx && \
    echo "abc ALL=(ALL) NOPASSWD: /bin/pkill" >> /etc/sudoers.d/gmweb-nginx && \
    chmod 0440 /etc/sudoers.d/gmweb-nginx

# Create LinuxServer custom init script (runs at container start)
RUN mkdir -p /custom-cont-init.d && \
    echo '#!/bin/bash' > /custom-cont-init.d/01-gmweb-init && \
    echo 'bash /opt/gmweb-startup/custom_startup.sh' >> /custom-cont-init.d/01-gmweb-init && \
    chmod +x /custom-cont-init.d/01-gmweb-init

# Expose ports for web services
# Port 80/443: nginx reverse proxy with HTTP Basic Auth (routes all traffic)
# Port 3000: LinuxServer webtop web UI (internal only)
# Port 8082: Selkies WebSocket streaming (internal only)
# Port 6901: VNC websocket (backup port if needed)
# Port 9997: OpenCode web editor (internal only)
EXPOSE 80 443 3000 6901 8082 9997
