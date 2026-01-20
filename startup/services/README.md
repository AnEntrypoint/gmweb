# gmweb Services

This directory contains all startup services for gmweb. Services are started in dependency order by the supervisor.

## Service Types

- **install**: One-time installation services (create wrappers, install packages)
- **system**: System services (tmux, sshd, etc.)
- **web**: Web services (opencode-web, file-manager, etc.)
- **critical**: Critical services that block startup if they fail

## Key Services

### Core Infrastructure
- **tmux**: Shared terminal session at port 9999 (via ttyd)
- **sshd**: SSH daemon for remote access
- **scrot**: Screenshot utility for testing

### OpenCode Editor
- **opencode**: Creates npx wrapper for opencode-ai binary
- **opencode-web**: Web interface at http://localhost:9997
  - Depends on: `glootie-oc`
  - Accessible via: `/code` endpoint with nginx reverse proxy

### Development Tools
- **glootie-oc**: OpenCode plugin with dev agents (gm, code-search, web-search)
- **claude-cli**: Claude command-line interface
- **claude-marketplace**: Claude Marketplace plugin installer
- **gemini-cli**: Google Gemini CLI wrapper
- **wrangler**: Cloudflare Wrangler CLI

### Utilities
- **file-manager**: NHFS web file browser at http://localhost:3001
- **webssh2**: Web-based SSH client
- **playwriter**: Playwriter MCP relay for browser automation
- **chromium-ext**: Enables Chromium extensions

### Installation Services
- **gcloud**: Google Cloud SDK installer
- **claude-plugin-gm**: GM plugin for Claude

## Service Dependencies

Services are executed in topological order. Specify dependencies in your service's export:

```javascript
export default {
  name: 'my-service',
  dependencies: ['service-a', 'service-b'], // Will wait for these
  // ...
}
```

Example: `opencode-web` depends on `glootie-oc` to load agents.

## Creating a New Service

```javascript
export default {
  name: 'my-service',
  type: 'web', // or 'system', 'install', 'critical'
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    console.log('[my-service] Starting...');
    // Your startup logic here
    const ps = spawn('...', [...]);
    
    return {
      pid: ps.pid,
      process: ps,
      cleanup: async () => { /* cleanup */ }
    };
  },

  async health() {
    // Return true if service is healthy, false otherwise
    return checkServiceHealth();
  }
};
```

## Environment Variables

All services receive these environment variables from supervisor:

- `HOME`: User home directory (/config)
- `PATH`: Updated with NVM node bin path
- `PASSWORD`: HTTP Basic Auth password
- `COOLIFY_FQDN`: External domain (if deployed via Coolify)

Services may add their own environment variables before spawning.

## Health Checks

Health checks run every 30 seconds. Failed health checks trigger service restart with exponential backoff.

For install services, keep health checks lightweight - just check if wrapper/binary exists.

## Debugging

View service logs:
```bash
tail -f /config/logs/supervisor.log
tail -f /config/logs/services/my-service.log
```

Test service manually:
```bash
node /opt/gmweb-startup/index.js
```

## Common Issues

### Service won't start
- Check PATH includes `/usr/local/local/nvm/versions/node/v23.11.1/bin`
- Check HOME is set to `/config`
- Check dependencies are listed correctly

### Port already in use
- Kill existing process: `lsof -i :PORT | grep -v PID | awk '{print $2}' | xargs kill -9`

### npx wrapper fails
- Ensure full PATH is passed to spawn: `PATH: '/usr/local/local/nvm/versions/node/v23.11.1/bin:${env.PATH || '...'}'`
- Never rely on `/usr/bin/env` for node - always use full NVM path
