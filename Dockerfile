FROM kasmweb/ubuntu-noble-dind-rootless:aarch64-1.18.0-rolling-daily
USER root
RUN echo 'kasm-user ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers
RUN apt --fix-broken install
RUN dpkg --configure -a
RUN sudo apt update
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get install -y curl bash git build-essential ca-certificates golang-go jq

ENV NVM_DIR=/usr/local/nvm
RUN echo 'export PATH="/usr/local/nvm:$PATH"' >> ~/.bashrc
RUN mkdir /usr/local/nvm
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
RUN bash -c ". \$NVM_DIR/nvm.sh && nvm install 23.11.1 && nvm use 23.11.1 && nvm alias default 23.11.1"
RUN ARCH=$(uname -m); TARGETARCH=$([ "$ARCH" = "x86_64" ] && echo "amd64" || echo "arm64"); DOWNLOAD_URL=$(curl -s https://api.github.com/repos/Finesssee/ProxyPilot/releases/latest | jq -r ".assets[] | select(.name | contains(\"proxypilot-linux-${TARGETARCH}\")) | .browser_download_url" | head -1); curl -L -o /usr/bin/proxypilot "$DOWNLOAD_URL" && chmod +x /usr/bin/proxypilot
RUN chmod +x /usr/bin/proxypilot
RUN apt update && apt install -y curl software-properties-common apt-transport-https gnupg && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt update && apt install -y gh && \
    rm -rf /var/lib/apt/lists/*
RUN mkdir /home/kasm-user/Desktop
RUN chmod a+rw /home/kasm-user -R
RUN chown 1000 /home/kasm-user -R
RUN mkdir /home/kasm-user/Desktop/Uploads
ENV PATH="/usr/local/nvm/versions/node/v23.11.1/bin:$PATH"
RUN npm install -g @musistudio/claude-code-router
RUN echo "/usr/local/nvm/versions/node/v23.11.1/bin/npx -y gxe@latest AnEntrypoint/kasmproxy start" > $STARTUPDIR/custom_startup.sh
RUN echo "/usr/bin/proxypilot" >> $STARTUPDIR/custom_startup.sh
RUN echo "claude --dangerously-skip-permissions \$@" > /sbin/cc
RUN chmod +x /sbin/cc
RUN chown -R kasm-user:kasm-user /home/kasm-user/.config
RUN mkdir -p /home/kasm-user/.config/autostart
RUN wget -nc -O /home/user/config.yaml https://raw.githubusercontent.com/Finesssee/ProxyPilot/refs/heads/main/config.example.yaml
RUN printf "[Desktop Entry]\nType=Application\nName=Chromium\nExec=/usr/bin/chromium\nOnlyShowIn=XFCE;\n" > /home/kasm-user/.config/autostart/ext.desktop
RUN printf "[Desktop Entry]\nType=Application\nName=Chromium\nExec=/usr/bin/chromium\nOnlyShowIn=XFCE;\n" > /home/kasm-user/.config/autostart/chromium.desktop
RUN printf "[Desktop Entry]\nType=Application\nName=Terminal\nExec=/usr/local/nvm/versions/node/v23.11.1/bin/npx -y gxe/@latest AnEntrypoint/chromeextensioninstaller chromeextensioninstaller jfeammnjpkecdekppnclgkkffahnhfhe\nOnlyShowIn=XFCE;\n" > /home/kasm-user/.config/autostart/terminal.desktop
RUN rm /home/kasm-user/.npm -R; chown 1000 /home/kasm-user -R
USER 1000
RUN curl -fsSL https://claude.ai/install.sh | bash
RUN echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
RUN $HOME/.local/bin/claude plugin marketplace add AnEntrypoint/gm
RUN $HOME/.local/bin/claude plugin install -s user gm@gm
