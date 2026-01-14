# syntax=docker/dockerfile:1.4
ARG ARCH=aarch64
FROM kasmweb/ubuntu-noble-dind-rootless:${ARCH}-1.18.0-rolling-daily
USER root
ENV DEBIAN_FRONTEND=noninteractive

# Fix broken install and configure apt
RUN echo 'kasm-user ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers && \
    apt --fix-broken install && \
    dpkg --configure -a && \
    apt update

# Install base system packages (stable layer)
RUN apt-get install -y --no-install-recommends \
    curl bash git build-essential ca-certificates golang-go jq \
    wget software-properties-common apt-transport-https gnupg && \
    rm -rf /var/lib/apt/lists/*

# Setup NVM and Node.js (stable - pinned version)
ENV NVM_DIR=/usr/local/nvm
RUN mkdir -p /usr/local/nvm && \
    echo 'export PATH="/usr/local/nvm:$PATH"' >> ~/.bashrc && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && \
    bash -c ". $NVM_DIR/nvm.sh && nvm install 23.11.1 && nvm use 23.11.1 && nvm alias default 23.11.1"

ENV PATH="/usr/local/nvm/versions/node/v23.11.1/bin:$PATH"

# Install GitHub CLI (stable - setup only)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt update && apt-get install -y --no-install-recommends gh && \
    rm -rf /var/lib/apt/lists/*

# Install npm global packages (stable - pinned versions)
RUN npm install -g @musistudio/claude-code-router

# Setup home directory structure (relatively stable)
RUN mkdir -p /home/kasm-user/Desktop/Uploads && \
    mkdir -p /home/kasm-user/.config/autostart && \
    chmod a+rw /home/kasm-user -R && \
    chown -R 1000:1000 /home/kasm-user && \
    chown -R kasm-user:kasm-user /home/kasm-user/.config

# Create autostart desktop entries (stable - application launchers)
RUN echo '[Desktop Entry]\nType=Application\nName=Terminal\nExec=/usr/bin/xfce4-terminal\nOnlyShowIn=XFCE;' | sed 's/\\n/\n/g' > /home/kasm-user/.config/autostart/terminal.desktop
RUN echo '[Desktop Entry]\nType=Application\nName=Chromium\nExec=/usr/bin/chromium\nOnlyShowIn=XFCE;' | sed 's/\\n/\n/g' > /home/kasm-user/.config/autostart/chromium.desktop
RUN echo '[Desktop Entry]\nType=Application\nName=Chrome Extension Installer\nExec=/usr/local/nvm/versions/node/v23.11.1/bin/npx -y gxe/@latest AnEntrypoint/chromeextensioninstaller chromeextensioninstaller jfeammnjpkecdekppnclgkkffahnhfhe\nOnlyShowIn=XFCE;' | sed 's/\\n/\n/g' > /home/kasm-user/.config/autostart/ext.desktop

# Setup startup scripts (stable - service configuration)
RUN echo "/usr/local/nvm/versions/node/v23.11.1/bin/npx -y gxe@latest AnEntrypoint/kasmproxy start" > $STARTUPDIR/custom_startup.sh && \
    echo "cd /home/kasm-user; /usr/bin/proxypilot" >> $STARTUPDIR/custom_startup.sh && \
    echo "claude --dangerously-skip-permissions \$@" > /sbin/cc && \
    chmod +x /sbin/cc

# Download dynamic binaries and configuration (volatile - fetched on each build)
RUN ARCH=$(uname -m) && \
    TARGETARCH=$([ "$ARCH" = "x86_64" ] && echo "amd64" || echo "arm64") && \
    DOWNLOAD_URL=$(curl -s https://api.github.com/repos/Finesssee/ProxyPilot/releases/latest | grep "proxypilot-linux-${TARGETARCH}" | grep -o '"browser_download_url": "[^"]*"' | cut -d'"' -f4 | head -1) && \
    curl -L -o /usr/bin/proxypilot "$DOWNLOAD_URL" && \
    chmod +x /usr/bin/proxypilot

# Download configuration file (volatile - may change)
RUN wget -nc -O /home/kasm-user/config.yaml https://raw.githubusercontent.com/Finesssee/ProxyPilot/refs/heads/main/config.example.yaml

# Switch to user and install Claude CLI and plugins (volatile - latest versions)
USER 1000
RUN curl -fsSL https://claude.ai/install.sh | bash && \
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

RUN $HOME/.local/bin/claude plugin marketplace add AnEntrypoint/gm && \
    $HOME/.local/bin/claude plugin install -s user gm@gm
