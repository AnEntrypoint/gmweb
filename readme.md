# gmweb - Automated Service Version Management

## Version Check Service Documentation

### Overview

The version-check service (`startup/services/version-check.js`) automatically monitors bunx-based services for available updates every 60 seconds. When newer versions are detected, it seamlessly restarts the affected service to pick up the update.

This implementation provides:
- Non-blocking background monitoring (doesn't delay supervisor startup)
- Graceful network error handling (never crashes on registry issues)
- Support for both npm and GitHub package sources
- Semantic version comparison (correctly identifies newer versions)
- Automatic service restart on update detection
- Comprehensive logging to supervisor output

### Architecture

#### Service Design Pattern

The version-check service follows the gmweb supervisor pattern:

```javascript
export default {
  name: 'version-check',
  type: 'system',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    // Start background checker process
    // Return immediately (don't block supervisor)
  },

  async health() {
    // Always return true (no port binding to verify)
    return true;
  }
};
```

#### How It Works

1. **Supervisor loads version-check service** (startup/index.js)
2. **Service starts immediately** (no blocking operations)
3. **Background checker begins 60-second cycle**
4. **Each cycle:**
   - Query npm registry or GitHub API for latest versions
   - Compare with currently installed versions
   - If newer version found: kill service process
   - Supervisor detects death via health check
   - Supervisor restarts the service
5. **Service never crashes** - network errors are caught and logged

### Monitored Services

| Service | Source | Package | Notes |
|---------|--------|---------|-------|
| agentgui | npm | `agentgui` | Claude Code agent UI on /gm/ |
| aion-ui | npm | `aion-ui` | Admin UI (internal service) |
| opencode | npm | `opencode-ai` | OpenCode ACP provider |
| gloutie-oc | GitHub | `AnEntrypoint/gloutie-oc` | MCP tools and agents plugin |
| proxypilot | npm | `proxypilot` | Proxy management service |
| moltbot | npm | `molt.bot` | Moltbot workspace UI |

### Configuration

**Location:** `startup/config.json`

```json
{
  "version-check": {
    "enabled": true,
    "type": "system"
  }
}
```

**Enable/Disable:** Set `enabled: true` or `enabled: false`

**Change Check Interval:** Edit `startup/services/version-check.js` line:
```javascript
this.checkInterval = 60000; // milliseconds
```

### Implementation Details

#### Registry Queries

**npm Packages:**
```
GET https://registry.npmjs.org/{packageName}
Parse: response['dist-tags'].latest
```

**GitHub Repositories:**
```
GET https://api.github.com/repos/{owner}/{repo}/releases/latest
Parse: response.tag_name (with 'v' prefix removed)
```

#### Version Comparison

Semantic version comparison:
```javascript
1.0.0 < 1.0.1 < 1.1.0 < 2.0.0
```

- Compares major.minor.patch numerically
- Handles prerelease versions (e.g., 1.0.0-beta < 1.0.0)
- Works with various version formats

#### Process Restart Mechanism

When update detected:
1. Find all processes matching service name pattern
2. Send SIGTERM to process group
3. Wait 500ms
4. Send SIGKILL to force termination
5. Supervisor health check detects missing process
6. Supervisor restarts service automatically
7. Service picks up latest version from npm/GitHub

### Error Handling

The service implements defensive error handling:

| Error | Behavior | Log Level |
|-------|----------|-----------|
| Registry timeout (8s) | Skip service, continue checking | WARN |
| Network error | Log and continue to next service | WARN |
| Invalid JSON response | Log parse error and skip | WARN |
| Process not found | Log and continue | WARN |
| Kill failed | Log but don't crash | WARN |

**Critical guarantee:** No scenario causes the version-check service itself to crash.

### Logging Examples

```
2026-02-06T12:00:00.000Z [version-check] Starting version check cycle
2026-02-06T12:00:00.200Z [version-check:agentgui] Update available: 1.0.100 -> 1.0.110
2026-02-06T12:00:00.300Z [version-check:agentgui] Killed process(es) for restart
2026-02-06T12:00:00.300Z [version-check:agentgui] Restarted service for update
2026-02-06T12:00:00.400Z [version-check:opencode] Already on latest version: 1.1.53
2026-02-06T12:00:00.600Z [version-check] Version check cycle complete
```

**Log Levels:**
- **INFO**: Version updates found, services restarted
- **DEBUG**: Services already on latest, cycle complete
- **WARN**: Registry timeouts, network errors, parsing failures
- **ERROR**: Check cycle failures (non-fatal)

### Testing

Test script: `startup/test-version-check.js`

```bash
node startup/test-version-check.js
```

**Tests:**
- Service definition validation
- npm registry connectivity
- GitHub API connectivity
- Package version availability
- Semantic version comparison logic

**Expected Output:**
```
✓ Service definition is correct
✓ npm registry connection successful
✓ All monitored packages available
✓ Version comparison tests pass
```

### Performance

- **Memory:** Minimal (background task)
- **CPU:** Negligible (~100ms per check cycle)
- **Network:** ~6 requests per cycle (one per service)
- **Latency:** Staggered to prevent thundering herd

### Adding New Services

To monitor additional services:

1. **Edit** `startup/services/version-check.js`
2. **Add to SERVICES_TO_MONITOR:**

```javascript
// npm package:
{
  serviceName: 'my-service',
  bundleName: 'my-npm-package',
  type: 'npm'
}

// GitHub repository:
{
  serviceName: 'my-service',
  bundleName: 'my-service',
  type: 'github',
  github: 'owner/repo'
}
```

3. **Restart supervisor** (container restart)

### Troubleshooting

**Q: Version check not running?**
```bash
tail -100 /config/logs/supervisor.log | grep version-check
# Should show: "Starting version check service..."
```

**Q: Service not restarting on updates?**
```bash
ps aux | grep version-check
# Verify process is running

ps aux | grep agentgui
# Check if service process is being killed/restarted
```

**Q: Registry connectivity issues?**
```bash
# Test npm registry
curl -I https://registry.npmjs.org/express

# Test GitHub API
curl -I https://api.github.com/repos/AnEntrypoint/gloutie-oc/releases/latest
```

### Integration with Supervisor

The version-check service integrates with gmweb's supervisor system:

**Dependencies:** None (no blocking dependencies)

**Service Type:** `system` (background process, no health port binding)

**Health Check:** Always passes (background task doesn't need verification)

**Restart Behavior:** Supervisor restarts on crash (rare)

### Files Modified

1. **Created:** `startup/services/version-check.js` (300+ lines)
2. **Created:** `startup/test-version-check.js` (200+ lines)
3. **Modified:** `startup/config.json` (added version-check service config)
4. **Modified:** `startup/index.js` (added version-check to service loader)

### Next Steps

After deployment:

1. **Verify service starts:**
   ```bash
   tail -50 /config/logs/supervisor.log | grep version-check
   ```

2. **Check for updates (wait 60 seconds):**
   ```bash
   tail -50 /config/logs/supervisor.log | grep "Update available"
   ```

3. **Monitor service restarts:**
   ```bash
   ps aux | grep agentgui  # Should see new process
   ```

### Security Notes

- Runs as `abc` user (no privilege escalation)
- Only kills own processes (isolated to supervisor group)
- No arbitrary code execution
- No API credentials required (public endpoints)
- Validates all JSON responses

### Future Enhancements

Potential improvements:

- Per-service check schedules
- Automatic rollback on restart failure
- Update metrics and analytics
- Admin notifications
- Staged updates (test, then deploy)
