# Technical Caveats

### Environment Setup: .bashrc vs .profile

**Problem**: `.profile` is only sourced by login shells (SSH, su), not by default Kasm terminal sessions. Environment variables set in `.profile` during build time are not available in interactive shells.

**Solution**: Move environment configuration to `.bashrc` with idempotent setup in `custom_startup.sh`:
- During build: Remove `.profile` exports, set explicit `ENV PATH` in Dockerfile for build-time use
- At runtime (first boot only): custom_startup.sh checks for marker `GMWeb Environment Setup` in `.bashrc`
  - If marker not found → appends PATH exports to `.bashrc` once
  - If marker found → skips (idempotent - prevents duplicates on container restarts)
- Persisted `/usr/local` volume means `.bashrc` changes survive container restarts
- All interactive shells now have access to Node.js and npm tools

**Implementation**: Dockerfile line 88-93 (custom_startup.sh idempotent check block) + line 23 (explicit PATH for build-time use)

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

