FROM kasmweb/ubuntu-noble-dind-rootless:aarch64-1.18.0-rolling-daily

LABEL maintainer="gmweb"
LABEL org.opencontainers.image.description="Claude Code development environment with Docker-in-Docker, NVM, and gmweb plugins"
LABEL org.opencontainers.image.version="1.0.0"

USER root

# Update system and install build dependencies
RUN apt update && apt install -y \
    curl bash git build-essential ca-certificates golang-go \
    software-properties-common apt-transport-https gnupg \
    && rm -rf /var/lib/apt/lists/*

# Allow passwordless sudo for kasm-user
RUN echo 'kasm-user ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers

# Setup NVM and Node.js
ENV NVM_DIR=/usr/local/nvm \
    NODE_VERSION=23.11.1 \
    PATH=/usr/local/nvm/versions/node/v23.11.1/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN mkdir -p ${NVM_DIR} && \
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash && \
    bash -c ". ${NVM_DIR}/nvm.sh && nvm install ${NODE_VERSION} && nvm use ${NODE_VERSION} && nvm alias default ${NODE_VERSION}"

# Install ProxyPilot
RUN curl -s https://api.github.com/repos/Finesssee/ProxyPilot/releases/latest | \
    grep "browser_download_url.*linux-arm64" | \
    cut -d : -f 2,3 | tr -d \" | \
    xargs curl -L -o /usr/bin/proxypilot && \
    chmod +x /usr/bin/proxypilot

# Setup GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | \
    dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | \
    tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt update && apt install -y gh && \
    rm -rf /var/lib/apt/lists/*

# Setup workspace
RUN mkdir -p /home/kasm-user/Desktop/Uploads && \
    chmod a+rw /home/kasm-user -R && \
    chown 1000:1000 /home/kasm-user -R

# Install Claude Code and plugins globally
RUN npm install -g @musistudio/claude-code-router

# Create startup script for gm plugin and services
RUN mkdir -p ${STARTUPDIR} && \
    printf '#!/bin/bash\nset -e\n\n# Start core services\nnpx -y gxe@latest AnEntrypoint/kasmproxy start &\nnpx -y gxe@latest AnEntrypoint/chromeextensioninstaller chromeextensioninstaller jfeammnjpkecdekppnclgkkffahnhfhe &\n./proxypilot &\n\n# Wait for all background services\nwait\n' > ${STARTUPDIR}/custom_startup.sh && \
    chmod +x ${STARTUPDIR}/custom_startup.sh

# Create Claude Code wrapper
RUN printf '#!/bin/bash\nclaude --dangerously-skip-permissions "$@"\n' > /sbin/cc && \
    chmod +x /sbin/cc

# Setup user configuration
RUN chown -R kasm-user:kasm-user /home/kasm-user/.config && \
    mkdir -p /home/kasm-user/.config/autostart

# Create desktop autostart entries
RUN printf '[Desktop Entry]\nType=Application\nName=Chromium\nExec=/usr/bin/chromium\nOnlyShowIn=XFCE;\n' > /home/kasm-user/.config/autostart/chromium.desktop && \
    printf '[Desktop Entry]\nType=Application\nName=Terminal\nExec=/usr/bin/xfce4-terminal\nOnlyShowIn=XFCE;\n' > /home/kasm-user/.config/autostart/terminal.desktop

# Switch to kasm-user and install Claude CLI
USER 1000

RUN curl -fsSL https://claude.ai/install.sh | bash && \
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && \
    $HOME/.local/bin/claude plugin marketplace add AnEntrypoint/gm && \
    $HOME/.local/bin/claude plugin install -s user gm@gm

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:6901/api/health || exit 1

# Expose ports
EXPOSE 6901 22 2375

# Set working directory
WORKDIR /home/kasm-user

# Default command (can be overridden in compose or CLI)
CMD ["/bin/bash"]
