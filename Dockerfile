FROM lscr.io/linuxserver/webtop:ubuntu-xfce

# Copy startup scripts (will be executed at runtime)
COPY docker/99-gmweb-startup.sh /custom-cont-init.d/99-gmweb-startup.sh
COPY docker/custom_startup.sh /custom-cont-init.d/custom_startup.sh
COPY docker/background-installs.sh /custom-cont-init.d/background-installs.sh
RUN chmod +x /custom-cont-init.d/99-gmweb-startup.sh /custom-cont-init.d/custom_startup.sh /custom-cont-init.d/background-installs.sh

# Copy s6-rc service overrides (to customize inherited services from LinuxServer image)
COPY docker/s6-overlay-mods/ /
RUN chmod +x /etc/s6-overlay/s6-rc.d/svc-selkies/run

EXPOSE 80 443
