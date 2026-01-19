import http from 'http';
import { promisify } from 'util';

const sleep = promisify(setTimeout);

const WEBTOP_UI_PORT = 3000;
const SELKIES_WS_PORT = 8082;

function stripSubfolder(fullPath, subfolder) {
  if (subfolder === '/') return fullPath;
  const pathOnly = fullPath.split('?')[0];
  if (pathOnly === subfolder.slice(0, -1) || pathOnly === subfolder) {
    return '/';
  }
  if (pathOnly.startsWith(subfolder)) {
    return pathOnly.slice(subfolder.length - 1) + (fullPath.includes('?') ? '?' + fullPath.split('?')[1] : '');
  }
  return fullPath;
}

function getUpstreamPort(path) {
  if (path.startsWith('/data') || path.startsWith('/ws')) {
    return SELKIES_WS_PORT;
  }
  return WEBTOP_UI_PORT;
}

function shouldBypassAuth(path) {
  return path.startsWith('/data') || path.startsWith('/ws');
}

function checkAuth(authHeader, password) {
  if (!authHeader) return false;
  const [scheme, credentials] = authHeader.split(' ');
  if (scheme !== 'Basic') return false;
  try {
    const decoded = Buffer.from(credentials, 'base64').toString();
    const expected = 'kasm_user:' + password;
    if (decoded !== expected) return false;
    return true;
  } catch {
    return false;
  }
}

export default {
  name: 'kasmproxy',
  type: 'critical',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const listenPort = 8080;
    const password = env.PASSWORD || 'password';
    const subfolder = (env.SUBFOLDER || '/').replace(/\/+$/, '') || '/';

    return new Promise((resolve, reject) => {
      console.log('[kasmproxy] Starting local HTTP proxy');
      console.log('[kasmproxy] LISTEN_PORT:', listenPort);
      console.log('[kasmproxy] PASSWORD:', password ? password.substring(0, 3) + '***' : '(not set)');
      console.log('[kasmproxy] SUBFOLDER:', subfolder);

      const server = http.createServer((req, res) => {
      const path = stripSubfolder(req.url, subfolder);
      const bypassAuth = shouldBypassAuth(path);

      if (password && !bypassAuth) {
        if (!checkAuth(req.headers.authorization, password)) {
          res.writeHead(401, {
            'WWW-Authenticate': 'Basic realm="kasmproxy"',
            'Content-Type': 'text/plain'
          });
          res.end('Unauthorized');
          return;
        }
      }

      const upstreamPort = getUpstreamPort(path);
      const headers = { ...req.headers };
      delete headers.host;
      delete headers.authorization;
      headers.host = `localhost:${upstreamPort}`;

      const options = {
        hostname: 'localhost',
        port: upstreamPort,
        path: path,
        method: req.method,
        headers
      };

      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('[kasmproxy] Error forwarding request:', err.message);
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway');
      });

      req.pipe(proxyReq);
    });

    server.on('upgrade', (req, socket, head) => {
      const path = stripSubfolder(req.url, subfolder);
      const bypassAuth = shouldBypassAuth(path);

      if (password && !bypassAuth) {
        if (!checkAuth(req.headers.authorization, password)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="kasmproxy"\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nUnauthorized');
          socket.destroy();
          return;
        }
      }

      const upstreamPort = getUpstreamPort(path);
      const headers = { ...req.headers };
      delete headers.host;
      delete headers.authorization;
      headers.host = `localhost:${upstreamPort}`;

      const options = {
        hostname: 'localhost',
        port: upstreamPort,
        path: path,
        method: req.method,
        headers
      };

      const proxyReq = http.request(options);

      proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\n');
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (key.toLowerCase() !== 'connection') {
            socket.write(`${key}: ${value}\r\n`);
          }
        }
        socket.write('Connection: Upgrade\r\n\r\n');

        if (proxyHead && proxyHead.length > 0) {
          socket.write(proxyHead);
        }

        proxySocket.pipe(socket);
        socket.pipe(proxySocket);

        socket.on('error', () => proxySocket.destroy());
        proxySocket.on('error', () => socket.destroy());
        socket.on('close', () => proxySocket.destroy());
        proxySocket.on('close', () => socket.destroy());
      });

      proxyReq.on('response', (proxyRes) => {
        socket.write(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`);
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          socket.write(`${key}: ${value}\r\n`);
        }
        socket.write('\r\n');
        proxyRes.pipe(socket);
      });

      proxyReq.on('error', (err) => {
        console.error('[kasmproxy] Error upgrading WebSocket:', err.message);
        socket.write('HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nBad Gateway');
        socket.destroy();
      });

      proxyReq.end(head);
    });

      server.listen(listenPort, '0.0.0.0', () => {
        console.log(`[kasmproxy] Listening on port ${listenPort}`);
        console.log(`[kasmproxy] Forwarding to Webtop UI on port ${WEBTOP_UI_PORT}`);
        console.log(`[kasmproxy] Forwarding /data and /ws to Selkies on port ${SELKIES_WS_PORT}`);
        console.log('[kasmproxy] Public routes: /data/*, /ws/*');

        resolve({
          pid: process.pid,
          process: null,
          cleanup: async () => {
            server.close();
          }
        });
      });

      server.on('error', (err) => {
        console.error('[kasmproxy] Server error:', err);
        reject(err);
      });

      process.on('SIGTERM', () => {
        console.log('[kasmproxy] Shutting down...');
        server.close(() => process.exit(0));
      });
    });
  },

  async health() {
    try {
      const { execSync } = await import('child_process');
      execSync('lsof -i :8080 | grep -q LISTEN', { stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }
};
