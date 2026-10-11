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
# HTTP proxy (Coolify Traefik / nginx); WebSockets carries it over the proxied HTTPS port.
# WebRTC is only reachable when the edge firewall forwards UDP to this host (see
# docker-compose.yaml). The boxone deployment sits behind a SonicWALL that forwards no
# inbound UDP, so a WebRTC host candidate cannot be connected to from the internet and
# the stream never starts. Default to WebSockets, which rides the already-forwarded
# HTTPS port and works everywhere; SELKIES_ENABLE_DUAL_MODE keeps WebRTC switchable at
# runtime (POST /desk/api/switch {"mode":"webrtc"}) once that UDP port is opened.
# SELKIES_WEBRTC_UDP_MUX_PORT must be published as udp on the host (see docker-compose.yaml).
# SELKIES_WEBRTC_PUBLIC_IP must be the host's public IP when behind 1:1 NAT. svc-selkies/run
# autodetects it when the operator leaves it blank, so WebRTC host candidates name an
# address the client can actually reach rather than the container's private IP.
# Direct path only: rtc.json is STUN-only, so no TURN relay is ever offered to the browser.
# The file overrides every SELKIES_STUN_*/SELKIES_TURN_* setting (confirmed in Selkies docs).
COPY docker/selkies/rtc.json /etc/selkies/rtc.json
ENV SELKIES_MODE=websockets \
    SELKIES_ENABLE_DUAL_MODE=true \
    SELKIES_WEBRTC_UDP_MUX_PORT=59000 \
    SELKIES_WEBRTC_ICE_LITE=true \
    SELKIES_RTC_CONFIG_JSON=/etc/selkies/rtc.json

EXPOSE 80 443 59000/udp
