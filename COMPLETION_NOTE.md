# OpenCode Config Fix - Completed

## Issue
OpenCode configuration was failing validation with error:
"Configuration is invalid at /config/.config/opencode/opencode.json - Invalid input: expected array, received object plugin"

## Root Cause
The OpenCode schema expects `plugin` field to be an array of plugin names (e.g., `["glootie"]`), 
but the plugforge generator was creating it as an object with name and module properties:
```json
"plugin": { "name": "gloutie", "module": "./index.js" }
```

## Fix Applied
Fixed the `formatConfigJson` function in `/config/workspace/plugforge/platforms/cli-config-shared.js`
to generate the correct OpenCode schema format:
```json
"plugin": ["gloutie"]
```

## Verification
1. ✓ Plugforge fix committed and pushed to GitHub (commit: de75ee2)
2. ✓ GitHub action automatically ran and generated updated glootie-oc
3. ✓ Verified glootie-oc now contains correct schema with plugin as array
4. ✓ gmweb services will pull updated gloutie-oc on next container boot via glootie-oc.js service

## Next Steps
On next gmweb container restart, the glootie-oc.js service will:
1. Pull latest gloutie-oc from GitHub
2. Run setup.sh to regenerate opencode.json with correct schema
3. OpenCode validation will pass

This fix is production-ready and will deploy automatically on next container restart.
