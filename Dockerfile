# syntax=docker/dockerfile:1.4
FROM lscr.io/linuxserver/webtop:ubuntu-xfce

# EARLY SETUP: Create persistent /config directory structure for all installations
# This ensures NVM, npm packages, and all user tools persist across container restarts
# Note: /config is a mounted volume, so structure may already exist but needs verification
RUN mkdir -p /config/usr/local/lib /config/usr/local/bin /config/nvm /config/.tmp /config/logs && \
    chmod 755 /config 2>/dev/null || true && \
    chmod 755 /config/usr/local /config/usr/local/lib /config/usr/local/bin /config/nvm /config/.tmp /config/logs 2>/dev/null || true && \
    # Clean up any old residual symlinks from previous container versions
    rm -rf /usr/local/local 2>/dev/null || true && \
    # Remove ephemeral /usr/local to make way for persistent symlink
    rm -rf /usr/local 2>/dev/null || true && \
    ln -s /config/usr/local /usr/local && \
    # Configure npm to use persistent global directory
    echo 'prefix = /config/usr/local' > /etc/npmrc && \
    # Set environment for persistent paths
    echo 'NVM_DIR=/config/nvm' >> /etc/environment && \
    echo 'NPM_CONFIG_PREFIX=/config/usr/local' >> /etc/environment

COPY docker/custom_startup.sh /opt/gmweb-startup/custom_startup.sh
COPY docker/nginx-sites-enabled-default /opt/gmweb-startup/nginx-sites-enabled-default
COPY docker/shim_close_range.c /tmp/shim_close_range.c

RUN gcc -fPIC -shared /tmp/shim_close_range.c -o /usr/local/lib/libshim_close_range.so && \
    rm /tmp/shim_close_range.c && \
    echo 'LD_PRELOAD=/usr/local/lib/libshim_close_range.so' >> /etc/environment

RUN mkdir -p /opt/gmweb-startup /opt/nhfs /opt/AionUi /tmp/services /custom-cont-init.d && \
    chmod 755 /opt/gmweb-startup && \
    chmod 777 /opt/nhfs /opt/AionUi /tmp/services && \
    chmod +x /opt/gmweb-startup/custom_startup.sh && \
    cp /opt/gmweb-startup/nginx-sites-enabled-default /etc/nginx/sites-available/default && \
    echo '#!/bin/bash\nbash /opt/gmweb-startup/custom_startup.sh' > /custom-cont-init.d/01-gmweb-init && \
    chmod +x /custom-cont-init.d/01-gmweb-init

EXPOSE 80 443
