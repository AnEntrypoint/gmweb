#!/usr/bin/env node
/**
 * KasmProxy Authentication Wrapper
 *
 * Sits on port 80 and forwards to kasmproxy on port 8080
 * Selectively bypasses authentication for /files route while maintaining
 * HTTP Basic Auth for all other routes.
 *
 * This is necessary because AnEntrypoint/kasmproxy doesn't support
 * per-route auth bypass configuration.
 */

import http from 'http';
import net from 'net';

const KASMPROXY_PORT = 8080;
const LISTEN_PORT = 80;
const VNC_PW = process.env.VNC_PW || '';

/**
 * Routes that should bypass authentication
 */
function shouldBypassAuth(path) {
  // /files routes are public (file manager UI doesn't require auth)
  if (path === '/files' || path.startsWith('/files/') || path.startsWith('/files?')) {
    return true;
  }
  return false;
}

/**
 * Check if authorization header is valid
 */
function checkAuth(authHeader) {
  if (!authHeader) return false;
  const [scheme, credentials] = authHeader.split(' ');
  if (scheme !== 'Basic') return false;

  try {
    const decoded = Buffer.from(credentials, 'base64').toString();
    // Expected format: kasm_user:VNC_PW
    if (decoded !== 'kasm_user:' + VNC_PW) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Get basic auth header with VNC credentials
 */
function getBasicAuth() {
  if (!VNC_PW) return null;
  const credentials = 'kasm_user:' + VNC_PW;
  const encoded = Buffer.from(credentials).toString('base64');
  return 'Basic ' + encoded;
}

// Create HTTP server
const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0];

  // Check if this route should bypass auth
  const bypassAuth = shouldBypassAuth(path);

  // Enforce auth for protected routes
  if (VNC_PW && !bypassAuth) {
    if (!checkAuth(req.headers.authorization)) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="kasmproxy"',
        'Content-Type': 'text/plain'
      });
      res.end('Unauthorized');
      return;
    }
  }

  // Forward request to kasmproxy on 8080
  const headers = { ...req.headers };
  delete headers.host;
  headers.host = `localhost:${KASMPROXY_PORT}`;

  // Always send auth to kasmproxy (it expects it)
  const basicAuth = getBasicAuth();
  if (basicAuth && !headers.authorization) {
    headers.authorization = basicAuth;
  }

  const options = {
    hostname: 'localhost',
    port: KASMPROXY_PORT,
    path: req.url,
    method: req.method,
    headers
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Pass through response headers
    res.writeHead(proxyRes.statusCode, proxyRes.headers);

    // Pass through response body
    proxyRes.pipe(res);
  });

  // Handle errors
  proxyReq.on('error', (err) => {
    console.error('[wrapper] Error forwarding request:', err.message);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Bad Gateway');
  });

  // Pass through request body
  req.pipe(proxyReq);
});

/**
 * Handle WebSocket upgrade requests
 * WebSockets require special handling via the 'upgrade' event, not regular HTTP
 */
server.on('upgrade', (req, socket, head) => {
  const path = req.url.split('?')[0];

  // Check if this route should bypass auth
  const bypassAuth = shouldBypassAuth(path);

  // Enforce auth for protected routes
  if (VNC_PW && !bypassAuth) {
    if (!checkAuth(req.headers.authorization)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="kasmproxy"\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nUnauthorized');
      socket.destroy();
      return;
    }
  }

  // Forward request to kasmproxy on 8080
  const headers = { ...req.headers };
  delete headers.host;
  headers.host = `localhost:${KASMPROXY_PORT}`;

  // Always send auth to kasmproxy (it expects it)
  const basicAuth = getBasicAuth();
  if (basicAuth && !headers.authorization) {
    headers.authorization = basicAuth;
  }

  const options = {
    hostname: 'localhost',
    port: KASMPROXY_PORT,
    path: req.url,
    method: req.method,
    headers
  };

  const proxyReq = http.request(options);

  // Handle upgrade response from kasmproxy
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    // Send upgrade response back to client
    socket.write('HTTP/1.1 101 Switching Protocols\r\n');
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (key.toLowerCase() !== 'connection') {
        socket.write(`${key}: ${value}\r\n`);
      }
    }
    socket.write('Connection: Upgrade\r\n\r\n');

    // Pipe the proxy response head data
    if (proxyHead && proxyHead.length > 0) {
      socket.write(proxyHead);
    }

    // Pipe both directions
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);

    // Handle errors and closures
    socket.on('error', () => proxySocket.destroy());
    proxySocket.on('error', () => socket.destroy());
    socket.on('close', () => proxySocket.destroy());
    proxySocket.on('close', () => socket.destroy());
  });

  // Handle non-upgrade responses
  proxyReq.on('response', (proxyRes) => {
    socket.write(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`);
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      socket.write(`${key}: ${value}\r\n`);
    }
    socket.write('\r\n');
    proxyRes.pipe(socket);
  });

  proxyReq.on('error', (err) => {
    console.error('[wrapper] Error upgrading WebSocket:', err.message);
    socket.write('HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nBad Gateway');
    socket.destroy();
  });

  // Send the upgrade request
  proxyReq.end(head);
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`[kasmproxy-wrapper] Listening on port ${LISTEN_PORT}`);
  console.log(`[kasmproxy-wrapper] Forwarding to kasmproxy on port ${KASMPROXY_PORT}`);
  console.log(`[kasmproxy-wrapper] Public routes: /files`);
});

server.on('error', (err) => {
  console.error('[kasmproxy-wrapper] Server error:', err);
  process.exit(1);
});
