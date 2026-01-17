# syntax=docker/dockerfile:1.4
ARG ARCH=aarch64
FROM kasmweb/ubuntu-noble-dind-rootless:${ARCH}-1.18.0
USER root
ENV DEBIAN_FRONTEND=noninteractive

# Fix broken install and configure apt
RUN echo 'kasm-user ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers
RUN apt --fix-broken install
RUN dpkg --configure -a
RUN apt update

# Install base system packages (stable layer)
RUN apt-get install -y --no-install-recommends \
    curl bash git build-essential ca-certificates jq wget \
    software-properties-common apt-transport-https gnupg openssh-server \
    openssh-client tmux lsof
RUN rm -rf /var/lib/apt/lists/*

# Setup NVM and Node.js (stable - pinned version)
ENV NVM_DIR=/usr/local/local/nvm
RUN mkdir -p /usr/local/local/nvm
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
RUN bash -c ". $NVM_DIR/nvm.sh && nvm install 23.11.1 && nvm use 23.11.1 && nvm alias default 23.11.1"

ENV PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin:$PATH"

# Install GitHub CLI (stable - setup only)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
RUN echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
RUN apt update
RUN apt-get install -y --no-install-recommends gh
RUN rm -rf /var/lib/apt/lists/*

# Configure SSH for password authentication
RUN mkdir -p /run/sshd && \
    sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config && \
    grep -q '^PasswordAuthentication yes' /etc/ssh/sshd_config || echo 'PasswordAuthentication yes' >> /etc/ssh/sshd_config && \
    sed -i 's/^#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config && \
    sed -i 's/^UsePAM yes/UsePAM no/' /etc/ssh/sshd_config && \
    grep -q '^UsePAM no' /etc/ssh/sshd_config || echo 'UsePAM no' >> /etc/ssh/sshd_config && \
    /usr/bin/ssh-keygen -A && \
    echo 'kasm-user:kasm' | chpasswd

# Configure tmux globally
RUN printf 'set -g history-limit 2000\nset -g terminal-overrides "xterm*:smcup@:rmcup@"\nset-option -g allow-rename off\nset-option -g set-titles on\n' > /etc/tmux.conf && \
    mkdir -p /home/kasm-user/.tmux && \
    printf 'set -g history-limit 2000\nset -g terminal-overrides "xterm*:smcup@:rmcup@"\nset-option -g allow-rename off\n' > /home/kasm-user/.tmux.conf && \
    chown kasm-user:kasm-user /home/kasm-user/.tmux.conf

# Setup home directory structure (relatively stable)
RUN mkdir -p /home/kasm-user/Desktop/Uploads
RUN mkdir -p /home/kasm-user/.config/autostart
RUN mkdir -p /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml
RUN mkdir -p /home/kasm-user/logs

# Configure XFCE4 Terminal (font size 9)
RUN printf '<?xml version="1.0" encoding="UTF-8"?>\n\n<channel name="xfce4-terminal" version="1.0">\n  <property name="font-name" type="string" value="Monospace 9"/>\n</channel>\n' > /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-terminal.xml && \
    chown -R kasm-user:kasm-user /home/kasm-user/.config/xfce4 && \
    chmod 644 /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-terminal.xml

# Setup webssh2 (stable - web-based SSH client)
ENV WEBSSH2_LISTEN_PORT=9999
RUN git clone https://github.com/billchurch/webssh2.git /home/kasm-user/webssh2
RUN cd /home/kasm-user/webssh2 && npm install --production
RUN chown -R kasm-user:kasm-user /home/kasm-user/webssh2

# Setup node-file-manager-esm (stable - file manager web interface)
ENV PORT=9998
RUN git clone https://github.com/BananaAcid/node-file-manager-esm.git /home/kasm-user/node-file-manager-esm
RUN cd /home/kasm-user/node-file-manager-esm && npm install --production
RUN chown -R kasm-user:kasm-user /home/kasm-user/node-file-manager-esm

# Create cache and temp directories for Claude CLI before switching to user
RUN mkdir -p /home/kasm-user/.cache /home/kasm-user/.tmp && \
    chown -R kasm-user:kasm-user /home/kasm-user/.cache /home/kasm-user/.tmp
RUN chmod a+rw /home/kasm-user -R
RUN chown -R 1000:1000 /home/kasm-user

# Copy modular startup system (from project root startup/ directory)
COPY startup/ /home/kasm-user/gmweb-startup/
RUN cd /home/kasm-user/gmweb-startup && npm install --production && \
    chmod +x /home/kasm-user/gmweb-startup/index.js && \
    chown -R kasm-user:kasm-user /home/kasm-user/gmweb-startup && \
    ls -la /home/kasm-user/gmweb-startup/

# Copy KasmWeb startup hook
COPY docker/custom_startup.sh /dockerstartup/custom_startup.sh
RUN chmod +x /dockerstartup/custom_startup.sh && \
    chown kasm-user:kasm-user /dockerstartup/custom_startup.sh

# Create simple wrapper for Claude CLI
RUN echo "claude --dangerously-skip-permissions \$@" > /sbin/cc
RUN chmod +x /sbin/cc

# Switch to user - all runtime services start here
USER 1000
