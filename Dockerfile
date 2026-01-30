# syntax=docker/dockerfile:1.4
FROM lscr.io/linuxserver/webtop:ubuntu-xfce

# Install build tools and runtime dependencies
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    gcc \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Compile close_range syscall shim at build time (Oracle kernel compatibility)
RUN mkdir -p /opt/lib
COPY docker/shim_close_range.c /tmp/shim_close_range.c
RUN gcc -fPIC -shared /tmp/shim_close_range.c -o /opt/lib/libshim_close_range.so && \
    rm /tmp/shim_close_range.c

# Set up LD_PRELOAD for all processes (for Oracle kernel compatibility)
ENV LD_PRELOAD=/opt/lib/libshim_close_range.so

# Set up npm/nvm paths in environment
ENV NVM_DIR=/config/nvm \
    NPM_CONFIG_PREFIX=/config/usr/local

# Create config volume paths at build time
RUN mkdir -p /config/usr/local/lib \
             /config/usr/local/bin \
             /config/nvm \
             /config/.tmp \
             /config/logs \
             /config/.gmweb-deps && \
    chmod 755 /config /config/usr/local /config/usr/local/lib /config/usr/local/bin /config/nvm /config/.tmp /config/logs /config/.gmweb-deps

# Set up /usr/local symlink to persistent volume
RUN rm -rf /usr/local && ln -s /config/usr/local /usr/local

# Configure npm
RUN echo 'prefix = /config/usr/local' > /etc/npmrc && \
    grep -q 'NVM_DIR=/config/nvm' /etc/environment || echo 'NVM_DIR=/config/nvm' >> /etc/environment && \
    grep -q 'NPM_CONFIG_PREFIX' /etc/environment || echo 'NPM_CONFIG_PREFIX=/config/usr/local' >> /etc/environment

# Copy nginx config
COPY docker/nginx-sites-enabled-default /tmp/nginx-sites-enabled-default
RUN mkdir -p /etc/nginx/sites-available && \
    cp /tmp/nginx-sites-enabled-default /etc/nginx/sites-available/default

# Copy init script and custom startup to container
COPY docker/99-gmweb-startup.sh /custom-cont-init.d/99-gmweb-startup.sh
RUN chmod +x /custom-cont-init.d/99-gmweb-startup.sh

COPY docker/custom_startup.sh /custom-cont-init.d/custom_startup.sh
RUN chmod +x /custom-cont-init.d/custom_startup.sh

EXPOSE 80 443
