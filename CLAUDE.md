# Technical Caveats

### Claude CLI Installation
- Cache directory `/home/kasm-user/.cache` must be created as root BEFORE switching to USER 1000
- Without pre-creation, Claude install fails with `EACCES: permission denied` on mkdir
- Fixed in Dockerfile line 139

### tmux Configuration
- History limit set to 2000 lines (Dockerfile lines 48, 50) to prevent pause when buffer fills while keeping scrollback
- history-limit 0 would prevent pausing but loses all history; 2000 is a balance
- Auto-attach configured in .bashrc (Dockerfile line 63)

### VNC_PW Environment Variable Propagation
- kasmproxy startup must explicitly export VNC_PW (Dockerfile line 93)
- Implementation: `bash -c 'export VNC_PW="${VNC_PW}" && ...'`
- sshd uses VNC_PW to set kasm-user password at runtime (Dockerfile line 105)

