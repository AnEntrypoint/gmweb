# Claude Code System Notes

## Caveats and Technical Details

### Docker Build Layer Caching
- The webssh2 git clone and npm install happen during Docker build
- Changing the Docker image will trigger a full rebuild of these layers
- Clone size ~10MB, npm install produces ~200MB node_modules
- Build time for webssh2 setup: ~45-60 seconds depending on network

### Node.js Version Pinning
- System uses Node v23.11.1 via NVM (pinned in Dockerfile line 22)
- webssh2 is compatible with this version
- npm version: 10.9.2
- Production dependencies only (267 packages including transitive dependencies)

### Startup Service Pattern
- All services use `nohup` for background execution
- Services run in parallel, not sequential
- Log files go to `/home/kasm-user/logs/`
- No dependency ordering between services
- **Important**: Services cannot communicate via stdio; use ports/sockets

### webssh2 Service Specifics
- Runs from `/home/kasm-user/webssh2`
- Entry point: `npm start` (executes bin/www)
- Default port: 2222 (check webssh2 config.json if changed)
- Log file: `/home/kasm-user/logs/webssh2.log`
- User: kasm-user (not root)

### Potential Issues and Recovery

#### Issue: webssh2 fails to start
- **Check**: `/home/kasm-user/logs/webssh2.log` for error details
- **Cause**: Port 2222 already in use or config.json missing
- **Fix**: Modify config.json in webssh2 directory or change port

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
- [ ] Port 2222 is listening (or configured port if changed)
- [ ] Can connect via web browser to webssh2 interface
