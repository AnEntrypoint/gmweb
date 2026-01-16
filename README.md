# gmweb - Kasm Workspace Custom Docker Setup

A Docker-based environment for web development and browser automation with integrated tools and services.

## Integrated Services

### Core Services
- **kasmproxy** - Proxy service for web routing
- **proxypilot** - Network proxy daemon
- **gemini-cli** - Google Gemini command-line interface
- **claude** - Claude CLI tools and plugins
- **chromium** - Browser with extension support
- **xfce4-terminal** - Desktop terminal emulator

### Web Services
- **webssh2** - Web-based SSH client (port 9999)

## Architecture

### Build Structure
- **Stable layers**: Base OS, NVM, Node.js, system packages (rarely change)
- **Volatile layers**: Downloaded binaries, extension setup (may change frequently)
- **User layer**: Custom startup scripts and home directory configuration

### Startup Sequence
All services start in parallel after desktop_ready signal:
1. kasmproxy - Desktop ready signal required
2. proxypilot - Desktop ready signal required
3. gemini-cli - Global npm install
4. chromium-extension - Python preferences setup
5. claude-marketplace - Plugin marketplace registration
6. claude-plugin - Plugin installation
7. claude-install - Latest Claude CLI installation
8. webssh2 - Web-based SSH server

Services run with `nohup` for background execution and log to `/home/kasm-user/logs/`.

## Key Files

- `Dockerfile` - Container build definition with all service configuration
- `.env.example` - Environment variable template
- `docker-compose.yaml` - Container orchestration
- `CLAUDE.md` - Technical caveats, gotchas, and debugging notes

## Building and Running

```bash
# Build the Docker image
docker-compose build

# Run the container
docker-compose up -d

# View logs
docker-compose logs -f

# Check specific service logs
tail -f /home/kasm-user/logs/webssh2.log
```

## Development Notes

### Adding New Services
When adding services to startup:
1. Add installation/setup in Dockerfile build stage
2. Add startup entry before line with `STARTUP COMPLETE`
3. Use `nohup ... > /home/kasm-user/logs/SERVICE.log 2>&1 &` pattern
4. Set proper ownership if user-specific (kasm-user)
5. Verify script position and log path in CLAUDE.md

### Node.js Environment
- Node.js v23.11.1 (pinned)
- npm v10.9.2
- NVM directory: `/usr/local/nvm`
- Global packages available to all services

### Users and Permissions
- Root user: Container setup and system configuration
- kasm-user (UID 1000): Runtime user for services and home directory
- Desktop environment runs as kasm-user via KASM framework

## Troubleshooting

See CLAUDE.md for detailed technical caveats, potential issues, and recovery procedures.
