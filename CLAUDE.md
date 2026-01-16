# Claude Code System Notes

## Caveats and Technical Details

### Docker Build Layer Caching
- The webssh2 and node-file-manager-esm git clones and npm installs happen during Docker build
- Changing the Docker image will trigger a full rebuild of these layers
- Clone sizes: webssh2 ~10MB, node-file-manager-esm ~5MB
- npm installs produce node_modules: webssh2 ~200MB, node-file-manager-esm ~100MB
- Build time for both services: ~90-120 seconds depending on network

### Node.js Version Pinning
- System uses Node v23.11.1 via NVM (pinned in Dockerfile line 22)
- Both webssh2 and node-file-manager-esm are compatible with this version
- npm version: 10.9.2
- Production dependencies only (webssh2: 110 packages, node-file-manager-esm: 45+ packages)

### Claude CLI Installation
- Cache directory `/home/kasm-user/.cache` must be created as root BEFORE switching to USER 1000
- Without pre-creation, Claude install fails with `EACCES: permission denied` on mkdir
- Solution: Create cache dir with chown as root, then switch user
- This was discovered during deployment and fixed in Dockerfile line 106

### Startup Service Pattern
- All services use `nohup` for background execution
- Services run in parallel, not sequential
- Log files go to `/home/kasm-user/logs/`
- No dependency ordering between services
- **Important**: Services cannot communicate via stdio; use ports/sockets

### VNC_PW Environment Variable Propagation
- **Issue**: VNC_PW was set during Docker build but not available to kasmproxy at runtime
- **Root cause**: Startup script didn't explicitly export VNC_PW to subprocess
- **Solution**: Modified kasmproxy startup to explicitly export VNC_PW (Dockerfile line 93)
- **Implementation**: Changed from direct npx call to bash -c with explicit `export VNC_PW="${VNC_PW}"` before npx command
- **Variable flow**: Docker ENV → custom_startup.sh parent process → bash -c subprocess → kasmproxy NPX process

### webssh2 SSH Authentication
- **Password**: `kasm` (set during Docker build at line 45)
- **Username**: `kasm-user`
- **SSH Configuration**:
  - `UsePAM: no` - Direct password authentication without PAM
  - `PasswordAuthentication: yes` - Password auth enabled
  - `PubkeyAuthentication: yes` - SSH keys supported
- **Auto-connect feature** (requires manual webssh2 code patch):
  - Modify `/home/kasm-user/webssh2/app/routes/routes-v2.ts` root route handler
  - Set `usedBasicAuth: true` in session.sshCredentials to trigger auto-connect
  - Default credentials: kasm-user@localhost:22 with password "kask"
  - When implemented: `/ssh` opens terminal directly with no login form
  - See implementation notes in routes-v2.ts line 267-283

### webssh2 Service Specifics
- Runs from `/home/kasm-user/webssh2`
- Entry point: `npm start` (executes index.js)
- Listen port: 9999 (configured via ENV WEBSSH2_LISTEN_PORT in Dockerfile line 46)
- Log file: `/home/kasm-user/logs/webssh2.log`
- User: kasm-user (not root)
- Configuration: Uses environment variables (12-factor app principle)
- **Important**: ENV WEBSSH2_LISTEN_PORT is set at build time and inherited by all RUN commands and startup

### node-file-manager-esm Service Specifics
- Runs from `/home/kasm-user/node-file-manager-esm`
- Entry point: `npm start` (executes bin/node-file-manager-esm.mjs)
- Listen port: 9998 (configured via ENV PORT in Dockerfile line 52)
- Log file: `/home/kasm-user/logs/node-file-manager-esm.log`
- User: kasm-user (not root)
- Configuration: Uses environment variable PORT (12-factor app principle)
- **Important**: ENV PORT is set at build time and inherited by all RUN commands and startup

### Potential Issues and Recovery

#### Issue: SSH authentication fails with "All configured authentication methods failed"
- **Root cause**: PAM was enabled but not properly configured for password auth
- **Solution**: Disable PAM (`UsePAM no`) and set default password for kasm-user
- **Location**: Dockerfile lines 42-45

#### Issue: webssh2 fails to start
- **Check**: `/home/kasm-user/logs/webssh2.log` for error details
- **Cause**: Port 9999 already in use or startup environment variable not set
- **Fix**: Change ENV WEBSSH2_LISTEN_PORT value in Dockerfile line 46 to alternative port

#### Issue: node-file-manager-esm fails to start
- **Check**: `/home/kasm-user/logs/node-file-manager-esm.log` for error details
- **Cause**: Port 9998 already in use or startup environment variable not set
- **Fix**: Change ENV PORT value in Dockerfile line 52 to alternative port

#### Issue: npm start doesn't work in nohup context
- **Approach**: `npm start` script exists in package.json
- **Fallback**: Could use `node bin/www` directly if npm start fails
- **Recovery**: Edit startup script in Dockerfile line 73

#### Issue: Permissions denied on webssh2 directory
- **Prevention**: chown -R kasm-user:kasm-user applied at build time
- **Check**: `ls -la /home/kasm-user/webssh2` should show kasm-user:kasm-user
- **Root cause**: Build layer caching or layer execution order
