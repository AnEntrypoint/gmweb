FROM lscr.io/linuxserver/webtop:ubuntu-xfce

# Copy startup scripts (will be executed at runtime)
COPY docker/99-gmweb-startup.sh /custom-cont-init.d/99-gmweb-startup.sh
RUN chmod +x /custom-cont-init.d/99-gmweb-startup.sh

EXPOSE 80 443
