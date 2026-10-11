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
# The boxone deployment sits behind a SonicWALL that forwards no inbound UDP rule, so the
# only way UDP reaches this host is a mapping the host opens itself by sending first. That
# is what full ICE does, so WebRTC works without a firewall change — WebSockets stays
# available as the fallback, and SELKIES_ENABLE_DUAL_MODE lets either side switch at runtime
# (POST /desk/api/switch {"mode":"webrtc"|"websockets"}).
# SELKIES_WEBRTC_UDP_MUX_PORT must be published as udp on the host (see docker-compose.yaml).
# SELKIES_WEBRTC_PUBLIC_IP must be the host's public IP when behind 1:1 NAT. svc-selkies/run
# autodetects it when the operator leaves it blank, so WebRTC host candidates name an
# address the client can actually reach rather than the container's private IP.
# SELKIES_WEBRTC_ICE_LITE is false on purpose — see the note in svc-selkies/run. A lite
# agent never sends checks, so it never opens the mapping the firewall requires.
# Direct path by default: rtc.json is STUN-only, so no relay is offered unless TURN is
# switched on. Precedence matters here — Selkies resolves its RTC config in the order
# Cloudflare TURN, this file, TURN REST, legacy TURN, HMAC TURN, built-in STUN default, and
# the first source that yields a config wins. So this file does override the legacy TURN
# options, but Cloudflare TURN is tried ahead of it and still takes effect when enabled.
COPY docker/selkies/rtc.json /etc/selkies/rtc.json
ENV SELKIES_MODE=webrtc \
    SELKIES_ENABLE_DUAL_MODE=true \
    SELKIES_WEBRTC_UDP_MUX_PORT=59000 \
    SELKIES_WEBRTC_ICE_LITE=false \
    SELKIES_RTC_CONFIG_JSON=/etc/selkies/rtc.json

EXPOSE 80 443 59000/udp
