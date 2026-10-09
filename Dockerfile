FROM lscr.io/linuxserver/webtop:ubuntu-xfce

COPY docker/99-gmweb-startup.sh /custom-cont-init.d/99-gmweb-startup.sh
COPY docker/custom_startup.sh /custom-cont-init.d/custom_startup.sh
COPY docker/nginx-setup.sh /custom-cont-init.d/nginx-setup.sh
COPY docker/nginx-sites-enabled-default /custom-cont-init.d/nginx-sites-enabled-default
COPY docker/rest-of-startup.sh /custom-cont-init.d/rest-of-startup.sh
COPY docker/background-installs.sh /custom-cont-init.d/background-installs.sh
RUN chmod +x /custom-cont-init.d/99-gmweb-startup.sh && \
    chmod -x /custom-cont-init.d/custom_startup.sh \
             /custom-cont-init.d/nginx-setup.sh \
             /custom-cont-init.d/rest-of-startup.sh \
             /custom-cont-init.d/background-installs.sh

COPY docker/s6-overlay-mods/ /
RUN chmod +x /etc/s6-overlay/s6-rc.d/svc-selkies/run

# Selkies transport. WebRTC carries media over UDP straight to the client, bypassing the
# HTTP proxy (Coolify Traefik / nginx). Signalling stays on the web port.
# SELKIES_WEBRTC_UDP_MUX_PORT must be published as udp on the host (see docker-compose.yaml).
# SELKIES_WEBRTC_PUBLIC_IP must be the host's public IP when behind 1:1 NAT (Oracle, most clouds).
# SELKIES_ENABLE_DUAL_MODE lets a client fall back to WebSockets when ICE cannot connect.
ENV SELKIES_MODE=webrtc \
    SELKIES_ENABLE_DUAL_MODE=true \
    SELKIES_WEBRTC_UDP_MUX_PORT=59000 \
    SELKIES_WEBRTC_ICE_LITE=true

EXPOSE 80 443 59000/udp
