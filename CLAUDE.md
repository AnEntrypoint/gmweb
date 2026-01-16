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

### webssh2 SSH Authentication
- **Status**: ✓ Fixed and verified working
- **Password**: `kasm` (set during Docker build at line 45)
- **Username**: `kasm-user`
- **SSH Configuration**:
  - `UsePAM: no` - Direct password authentication without PAM
  - `PasswordAuthentication: yes` - Password auth enabled
  - `PubkeyAuthentication: yes` - SSH keys supported
- **Auto-connect feature**:
  - `/ssh` root path opens terminal directly with auto-connect (no login form)
  - Auto-connect uses default credentials: kasm-user@localhost:22 with password "kasm"
  - Implementation: Root route handler sets session credentials and triggers auto-connect
  - Patch applied during Docker build (lines 71-108)
- **Verified**: SSH authentication tested via webssh2 UI and CLI, auto-connect confirmed working

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
- **Status**: ✓ FIXED
- **Root cause**: PAM was enabled but not properly configured for password auth
- **Solution**: Disable PAM (`UsePAM no`) and set default password for kasm-user
- **Fixed in**: Dockerfile lines 42-45
- **Verification**: SSH authentication now works via both CLI and webssh2 web UI

#### Issue: webssh2 fails to start
- **Check**: `/home/kasm-user/logs/webssh2.log` for error details
- **Cause**: Port 9999 already in use or startup environment variable not set
- **Fix**: Change ENV WEBSSH2_LISTEN_PORT value in Dockerfile line 46 to alternative port

#### Issue: node-file-manager-esm fails to start
- **Check**: `/home/kasm-user/logs/node-file-manager-esm.log` for error details
- **Cause**: Port 9998 already in use or startup environment variable not set
- **Fix**: Change ENV PORT value in Dockerfile line 52 to alternative port

#### Issue: npm start doesn't work in nohup context
- **Current approach**: Verified `npm start` script exists in package.json
- **Fallback**: Could use `node bin/www` directly if npm start fails
- **Recovery**: Edit startup script in Dockerfile line 73

#### Issue: Permissions denied on webssh2 directory
- **Prevention**: chown -R kasm-user:kasm-user applied at build time
- **Check**: `ls -la /home/kasm-user/webssh2` should show kasm-user:kasm-user
- **Root cause**: Build layer caching or layer execution order

### Testing Verification Performed
1. ✓ Repository clones successfully from GitHub
2. ✓ package.json is valid JSON
3. ✓ npm install --production completes without errors
4. ✓ node_modules directory created with 267 packages
5. ✓ npm start script present and callable
6. ✓ Startup script follows nohup pattern matching 7 other services

### Deployment Findings (Verified)
**January 16, 2026 - Services Successfully Running**
- ✓ webssh2 service running on port 9999
  - Process: `node dist/index.js` (PID 7875)
  - Port listening: `tcp 0.0.0.0:9999`
  - HTTP response: `404 Not Found` (service operational)
  - Started via: `nohup bash -c 'cd /home/kasm-user/webssh2 && WEBSSH2_LISTEN_PORT=9999 npm start'`

- ✓ node-file-manager-esm service running on port 9998
  - Process: `node ./bin/node-file-manager-esm.mjs --log` (PID 7800)
  - Port listening: `tcp6 :::9998`
  - HTTP response: `302 Found` redirect to /files (service operational)
  - Started via: `nohup bash -c 'cd /home/kasm-user/node-file-manager-esm && PORT=9998 npm start'`

**Installation & Startup Procedure (Post-Deployment)**
When container starts without pre-built services:
```bash
# Clone repositories
cd /home/kasm-user
git clone https://github.com/billchurch/webssh2.git webssh2
git clone https://github.com/BananaAcid/node-file-manager-esm.git node-file-manager-esm

# Install dependencies
cd webssh2 && npm install --production
cd ../node-file-manager-esm && npm install --production

# Start services with environment variables
nohup bash -c 'cd /home/kasm-user/webssh2 && WEBSSH2_LISTEN_PORT=9999 npm start' > /home/kasm-user/logs/webssh2.log 2>&1 &
nohup bash -c 'cd /home/kasm-user/node-file-manager-esm && PORT=9998 npm start' > /home/kasm-user/logs/node-file-manager-esm.log 2>&1 &
```

### Deployment Checklist
- [x] Docker build includes webssh2 and node-file-manager-esm setup
- [x] webssh2 service running and listening on port 9999
- [x] node-file-manager-esm service running and listening on port 9998
- [x] Both services responding to HTTP requests
- [x] Services can be accessed via `curl http://localhost:9999` and `curl http://localhost:9998`
