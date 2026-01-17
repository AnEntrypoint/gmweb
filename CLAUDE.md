# Technical Caveats

## Modular JS Startup Supervisor System

### Architecture Overview
The startup system is a modular, immortal supervisor (startup/index.js) that dynamically loads and manages 14 service modules. Key design pattern follows gm:state:machine rules - never crashes, always recovers, no mocks/fakes.

**Structure:**
```
startup/
├── index.js              # Main entry point, loads all services
├── lib/supervisor.js     # Immortal orchestrator, never exits
├── config.json           # Service enable/disable flags
├── services/*.js         # 14 service modules (kasmproxy, webssh2, etc.)
└── package.json          # ES6 modules, no external dependencies
```

### Custom Startup Command
The Dockerfile generates a minimal custom_startup.sh:
```bash
#!/bin/bash
echo "===== STARTUP $(date) =====" | tee -a /home/kasm-user/logs/startup.log
cd /home/kasm-user/gmweb-startup && node index.js &
```

This single line launches the immortal supervisor that manages all 14 services.

### Service Module Interface
Each service exports a standard interface:
```javascript
{
  name: 'service-name',
  type: 'critical|install|web|system',
  requiresDesktop: true|false,
  dependencies: ['other-service'],
  health: async () => boolean,
  start: async (env) => { pid, process, cleanup },
  stop: async (handle) => void
}
```

Services with `requiresDesktop: true` wait for `/usr/bin/desktop_ready` before starting. Dependency resolution uses topological sort.

### Configuring Services (No Rebuild Required)
Services are enabled/disabled via `startup/config.json`:
```json
{
  "services": {
    "kasmproxy": { "enabled": true },
    "proxypilot": { "enabled": true },
    "wrangler": { "enabled": false }
  }
}
```

Changing `enabled` flags does NOT require Docker rebuild. The supervisor checks this on startup.

### Health Monitoring and Recovery
- Health checks every 30 seconds
- Failed checks trigger auto-restart with exponential backoff
- Backoff: `min(5000 * 2^attempts, 60000)` ms (5s → 10s → 20s → 40s → 60s)
- Max 5 restart attempts per service before giving up

### VNC_PW Extraction
Environment setup happens in `supervisor.js:getEnvironment()`:
- Tries to extract from `/proc/1/environ` using `strings | grep`
- Falls back to VNC_PW env var if present
- Uses hardcoded 'password' as final fallback
- sshd service uses this to set kasm-user password at startup

### Dependency Resolution
Services can declare dependencies on other services. The supervisor performs topological sort:
- Example: `claude-plugin-gm` depends on `claude-marketplace` which depends on `claude-cli`
- Supervisor starts in order: claude-cli → marketplace (after 3s) → plugin-gm (after 6s)
- Circular dependencies are detected and rejected at startup

### Adding New Services
To add a new service:
1. Create `startup/services/myservice.js` with standard interface
2. Add to `startup/config.json` under `services`
3. No Dockerfile changes needed
4. Supervisor will auto-load on next startup

To remove: Delete the service file and entry from config.json.

### Immortal System Guarantees
The supervisor follows gm:state:machine mandatory rules:
- **Never crashes**: Global error handlers catch all exceptions
- **Always recovers**: Failed services auto-restart with backoff
- **No mocks**: Uses real child processes, real executables, real checks
- **Uncrashable**: Every boundary (supervisor, service, health monitor) has try/catch
- **Self-healing**: Health checks poll every 30s, restart failures automatically

### Claude CLI Installation
- Cache directory `/home/kasm-user/.cache` must be created as root BEFORE switching to USER 1000
- Without pre-creation, Claude install fails with `EACCES: permission denied` on mkdir
- Fixed in Dockerfile (before USER switch)

### tmux Configuration
- History limit 2000 lines (prevents pause when buffer full while keeping scrollback)
- Auto-attach via tmux service in startup system
- Session created at boot: main session with sshd window

### Logging
- supervisor.js logs to `/home/kasm-user/logs/supervisor.log`
- Each service logs to stdout (captured by nohup if run standalone)
- Aggregation via supervisor for centralized visibility
