# syntax=docker/dockerfile:1.4
FROM lscr.io/linuxserver/webtop:ubuntu-xfce

COPY docker/custom_startup.sh /opt/gmweb-startup/custom_startup.sh
COPY docker/nginx-sites-enabled-default /opt/gmweb-startup/nginx-sites-enabled-default

RUN mkdir -p /opt/gmweb-startup /opt/nhfs /opt/AionUi /tmp/services /custom-cont-init.d && \
    chmod 755 /opt/gmweb-startup && \
    chmod 777 /opt/nhfs /opt/AionUi /tmp/services && \
    chmod +x /opt/gmweb-startup/custom_startup.sh && \
    cp /opt/gmweb-startup/nginx-sites-enabled-default /etc/nginx/sites-available/default && \
    echo '#!/bin/bash\nbash /opt/gmweb-startup/custom_startup.sh' > /custom-cont-init.d/01-gmweb-init && \
    chmod +x /custom-cont-init.d/01-gmweb-init

EXPOSE 80 443
