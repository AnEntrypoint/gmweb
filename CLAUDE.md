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

### Deployment Checklist
- [ ] Docker build completes without errors
- [ ] webssh2 service appears in ps output after container starts
- [ ] `/home/kasm-user/logs/webssh2.log` is created and has content
- [ ] Port 9999 is listening (verify with: netstat -tlnp | grep 9999)
- [ ] Can connect via web browser to webssh2 interface (http://localhost:9999)
- [ ] node-file-manager-esm service appears in ps output after container starts
- [ ] `/home/kasm-user/logs/node-file-manager-esm.log` is created and has content
- [ ] Port 9998 is listening (verify with: netstat -tlnp | grep 9998)
- [ ] Can connect via web browser to file manager (http://localhost:9998)
