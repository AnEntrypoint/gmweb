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
RUN apt-get install -y --no-install-recommends curl bash git build-essential ca-certificates jq wget software-properties-common apt-transport-https gnupg openssh-server openssh-client tmux
RUN rm -rf /var/lib/apt/lists/*

# Setup NVM and Node.js (stable - pinned version)
ENV NVM_DIR=/usr/local/local/nvm
RUN mkdir -p /usr/local/local/nvm
RUN echo 'export PATH="/usr/local/local/nvm:$PATH"' >> ~/.profile
RUN echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
RUN bash -c ". $NVM_DIR/nvm.sh && nvm install 23.11.1 && nvm use 23.11.1 && nvm alias default 23.11.1"

ENV PATH="/usr/local/local/nvm/versions/node/v23.11.1/bin:$PATH"

# Install GitHub CLI (stable - setup only)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
RUN echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
RUN apt update
RUN apt-get install -y --no-install-recommends gh
RUN rm -rf /var/lib/apt/lists/*

# Install npm global packages (stable - pinned versions)
RUN npm install -g @musistudio/claude-code-router

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

# Configure tmux globally - keep a few pages of history to prevent pause on full buffer
RUN printf 'set -g history-limit 2000\nset -g terminal-overrides "xterm*:smcup@:rmcup@"\nset-option -g allow-rename off\nset-option -g set-titles on\n' > /etc/tmux.conf && \
    mkdir -p /home/kasm-user/.tmux && \
    printf 'set -g history-limit 2000\nset -g terminal-overrides "xterm*:smcup@:rmcup@"\nset-option -g allow-rename off\n' > /home/kasm-user/.tmux.conf && \
    chown kasm-user:kasm-user /home/kasm-user/.tmux.conf

# Setup home directory structure (relatively stable)
RUN mkdir -p /home/kasm-user/Desktop/Uploads
RUN mkdir -p /home/kasm-user/.config/autostart
RUN mkdir -p /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml
RUN mkdir -p /home/kasm-user/logs

# Configure bashrc for auto-tmux attach on terminal start
#RUN printf '\n# Auto-attach to tmux session\nif [ -z "$TMUX" ] && [ "$TERM" != "dumb" ]; then\n    exec tmux attach-session -t main || exec tmux new-session -s main\nfi\n' >> /home/kasm-user/.profile

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

# Create autostart desktop entries (stable - application launchers)
# All three files created atomically in single RUN for reliability
RUN printf '[Desktop Entry]\nType=Application\nName=Terminal\nExec=/usr/bin/xfce4-terminal\nOnlyShowIn=XFCE;\n' > /home/kasm-user/.config/autostart/terminal.desktop && \
    printf '[Desktop Entry]\nType=Application\nName=Chromium\nExec=/usr/bin/chromium\nOnlyShowIn=XFCE;\n' > /home/kasm-user/.config/autostart/chromium.desktop && \
    printf '[Desktop Entry]\nType=Application\nName=Chrome Extension Installer\nExec=/usr/local/nvm/versions/node/v23.11.1/bin/npx -y gxe@latest AnEntrypoint/chromeextensioninstaller chromeextensioninstaller jfeammnjpkecdekppnclgkkffahnhfhe\nOnlyShowIn=XFCE;\n' > /home/kasm-user/.config/autostart/ext.desktop && \
    chmod 644 /home/kasm-user/.config/autostart/*.desktop && \
    chown -R kasm-user:kasm-user /home/kasm-user/.config/autostart && \
    ls -la /home/kasm-user/.config/autostart/

# Configure XFCE4 Terminal (font size 9)
RUN printf '<?xml version="1.0" encoding="UTF-8"?>\n\n<channel name="xfce4-terminal" version="1.0">\n  <property name="font-name" type="string" value="Monospace 9"/>\n</channel>\n' > /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-terminal.xml && \
    chown -R kasm-user:kasm-user /home/kasm-user/.config/xfce4 && \
    chmod 644 /home/kasm-user/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-terminal.xml

# Setup startup scripts (stable - service configuration)
RUN echo "echo '===== STARTUP $(date) =====' | tee -a /home/kasm-user/logs/startup.log" > $STARTUPDIR/custom_startup.sh
RUN echo "/usr/bin/desktop_ready && nohup sudo -u kasm-user bash -c 'export VNC_PW=\"\$(strings /proc/1/environ | grep \"^VNC_PW=\" | cut -d= -f2-)\" && export PATH=\"/usr/local/local/nvm/versions/node/v23.11.1/bin:\$PATH\" && npx -y gxe@latest AnEntrypoint/kasmproxy start' > /home/kasm-user/logs/kasmproxy.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "/usr/bin/desktop_ready && nohup sudo -u kasm-user /usr/bin/proxypilot > /home/kasm-user/logs/proxypilot.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "nohup sudo -u kasm-user npm install -g @google/gemini-cli > /home/kasm-user/logs/gemini-cli.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "nohup sudo -u kasm-user npm install -g wrangler > /home/kasm-user/logs/wrangler.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "nohup sudo -u kasm-user bash -c 'curl https://sdk.cloud.google.com | bash' > /home/kasm-user/logs/gcloud-install.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "nohup apt-get update && apt-get install -y scrot > /home/kasm-user/logs/scrot-install.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "nohup sudo -u kasm-user python3 /usr/local/bin/enable_chromium_extension.py > /home/kasm-user/logs/chromium-ext.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "nohup sudo -u kasm-user bash -c 'curl -fsSL https://claude.ai/install.sh | bash' > /home/kasm-user/logs/claude-install.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "nohup sudo -u kasm-user /home/kasm-user/.local/bin/claude plugin marketplace add AnEntrypoint/gm > /home/kasm-user/logs/claude-marketplace.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "nohup sudo -u kasm-user /home/kasm-user/.local/bin/claude plugin install -s user gm@gm > /home/kasm-user/logs/claude-plugin.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "nohup sudo -u kasm-user bash -c 'cd /home/kasm-user/webssh2 && WEBSSH2_SSH_HOST=localhost WEBSSH2_SSH_PORT=22 WEBSSH2_USER_NAME=kasm-user WEBSSH2_USER_PASSWORD=kasm npm start' > /home/kasm-user/logs/webssh2.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "nohup sudo -u kasm-user bash -c 'cd /home/kasm-user/node-file-manager-esm && PORT=9998 npm start -- -d /home/kasm-user/Desktop' > /home/kasm-user/logs/node-file-manager-esm.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "mkdir -p /run/sshd && nohup bash -c 'if [ -n \"\$VNC_PW\" ]; then echo \"kasm-user:\$VNC_PW\" | chpasswd; fi && /usr/sbin/sshd' > /home/kasm-user/logs/sshd.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "nohup bash -c 'sudo -u kasm-user tmux new-session -d -s main -x 120 -y 30; sleep 1; sudo -u kasm-user tmux new-window -t main -n sshd' > /home/kasm-user/logs/tmux.log 2>&1 &" >> $STARTUPDIR/custom_startup.sh
RUN echo "echo '===== STARTUP COMPLETE =====' | tee -a /home/kasm-user/logs/startup.log" >> $STARTUPDIR/custom_startup.sh
RUN chmod +x $STARTUPDIR/custom_startup.sh

RUN echo "claude --dangerously-skip-permissions \$@" > /sbin/cc
RUN chmod +x /sbin/cc

# Setup Chromium policies
RUN mkdir -p /etc/chromium/policies/managed
RUN echo '{"ExtensionInstallForcelist": ["jfeammnjpkecdekppnclgkkffahnhfhe;https://clients2.google.com/service/update2/crx"]}' > /etc/chromium/policies/managed/extension_install_forcelist.json
RUN mkdir -p /opt/google/chrome/extensions
RUN chmod 777 /opt/google/chrome/extensions

# Create extension enablement Python script
RUN echo '#!/usr/bin/env python3' > /usr/local/bin/enable_chromium_extension.py
RUN echo 'import json, os, sys' >> /usr/local/bin/enable_chromium_extension.py
RUN echo 'prefs_file = os.path.expanduser("~/.config/chromium/Default/Preferences")' >> /usr/local/bin/enable_chromium_extension.py
RUN echo 'if os.path.exists(prefs_file):' >> /usr/local/bin/enable_chromium_extension.py
RUN echo '    try:' >> /usr/local/bin/enable_chromium_extension.py
RUN echo '        with open(prefs_file) as f: prefs = json.load(f)' >> /usr/local/bin/enable_chromium_extension.py
RUN echo '        prefs.setdefault("extensions", {}).setdefault("settings", {}).setdefault("jfeammnjpkecdekppnclgkkffahnhfhe", {})["active_bit"] = True' >> /usr/local/bin/enable_chromium_extension.py
RUN echo '        with open(prefs_file, "w") as f: json.dump(prefs, f)' >> /usr/local/bin/enable_chromium_extension.py
RUN echo '    except: pass' >> /usr/local/bin/enable_chromium_extension.py
RUN chmod +x /usr/local/bin/enable_chromium_extension.py

# Download dynamic binaries and configuration (volatile - fetched on each build)
RUN ARCH=$(uname -m) && TARGETARCH=$([ "$ARCH" = "x86_64" ] && echo "amd64" || echo "arm64") && DOWNLOAD_URL=$(curl -s https://api.github.com/repos/Finesssee/ProxyPilot/releases/latest | grep "proxypilot-linux-${TARGETARCH}" | grep -o '"browser_download_url": "[^"]*"' | cut -d'"' -f4 | head -1) && curl -L -o /usr/bin/proxypilot "$DOWNLOAD_URL"
RUN chmod +x /usr/bin/proxypilot

# Download configuration file (volatile - may change)
RUN wget -nc -O /home/kasm-user/config.yaml https://raw.githubusercontent.com/Finesssee/ProxyPilot/refs/heads/main/config.example.yaml

# Create cache directory for Claude CLI before switching to user
RUN mkdir -p /home/kasm-user/.cache && chown -R kasm-user:kasm-user /home/kasm-user/.cache
RUN chmod a+rw /home/kasm-user -R
RUN chown -R 1000:1000 /home/kasm-user
# Switch to user and install Claude CLI (volatile - latest versions)
USER 1000
#RUN curl -fsSL https://claude.ai/install.sh | bash
