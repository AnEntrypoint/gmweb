FROM lscr.io/linuxserver/webtop:ubuntu-xfce

# Copy startup scripts to /custom-cont-init.d/
# CRITICAL: Only 99-gmweb-startup.sh must be executable (+x).
# s6 init-custom-files runs ALL executable scripts in this directory alphabetically.
# Helper scripts (custom_startup.sh, nginx-setup.sh, rest-of-startup.sh,
# background-installs.sh, patch-selkies-webrtc.sh) are called explicitly from
# within the startup chain via "bash /path/to/script.sh" - they must NOT be
# executable or init-custom-files will run them independently, blocking s6-rc
# services (xorg, selkies, desktop) from ever starting.
COPY docker/99-gmweb-startup.sh /custom-cont-init.d/99-gmweb-startup.sh
COPY docker/custom_startup.sh /custom-cont-init.d/custom_startup.sh
COPY docker/nginx-setup.sh /custom-cont-init.d/nginx-setup.sh
COPY docker/rest-of-startup.sh /custom-cont-init.d/rest-of-startup.sh
COPY docker/background-installs.sh /custom-cont-init.d/background-installs.sh
COPY docker/patch-selkies-webrtc.sh /custom-cont-init.d/patch-selkies-webrtc.sh
RUN chmod +x /custom-cont-init.d/99-gmweb-startup.sh && \
    chmod -x /custom-cont-init.d/custom_startup.sh \
             /custom-cont-init.d/nginx-setup.sh \
             /custom-cont-init.d/rest-of-startup.sh \
             /custom-cont-init.d/background-installs.sh \
             /custom-cont-init.d/patch-selkies-webrtc.sh

# Copy s6-rc service overrides (to customize inherited services from LinuxServer image)
COPY docker/s6-overlay-mods/ /
RUN chmod +x /etc/s6-overlay/s6-rc.d/svc-selkies/run

EXPOSE 80 443
