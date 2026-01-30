FROM lscr.io/linuxserver/webtop:ubuntu-xfce

# Compile close_range shim at build time - needed before any process spawns
RUN mkdir -p /opt/lib && \
    cat > /tmp/shim_close_range.c << 'EOF' && \
#define _GNU_SOURCE
#include <errno.h>

int close_range(unsigned int first, unsigned int last, int flags) {
    errno = 38;
    return -1;
}
EOF
    gcc -fPIC -shared /tmp/shim_close_range.c -o /opt/lib/libshim_close_range.so && \
    rm /tmp/shim_close_range.c && \
    chmod 755 /opt/lib/libshim_close_range.so

# Set LD_PRELOAD for entire container - shim always available
ENV LD_PRELOAD=/opt/lib/libshim_close_range.so

# Copy startup scripts (will be executed at runtime)
COPY docker/99-gmweb-startup.sh /custom-cont-init.d/99-gmweb-startup.sh
RUN chmod +x /custom-cont-init.d/99-gmweb-startup.sh

EXPOSE 80 443
