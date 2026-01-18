#!/usr/bin/env node
/**
 * LinuxServer Webtop Authentication Wrapper with SUBFOLDER Support
 *
 * Sits on port 80 and forwards to:
 * - Webtop web UI on port 3000 (main desktop interface)
 * - Selkies WebSocket on port 8082 (VNC/desktop streaming)
 *
 * Selectively bypasses authentication for public routes while maintaining
 * HTTP Basic Auth for protected routes.
 *
 * Supports SUBFOLDER environment variable for running under a prefix path.
 * Example: SUBFOLDER=/desk/ routes /desk/* to internal services as /*
 */

import http from 'http';
import net from 'net';

const WEBTOP_UI_PORT = parseInt(process.env.CUSTOM_PORT || '3000', 10);
const SELKIES_WS_PORT = 8082;
const LISTEN_PORT = 80;
const PASSWORD = process.env.PASSWORD || '';
const SUBFOLDER = (process.env.SUBFOLDER || '/').replace(/\/+$/, '') || '/';

/**
 * Strip SUBFOLDER prefix from request path
 * Example: /desk/ui with SUBFOLDER=/desk/ becomes /ui
 */
function stripSubfolder(fullPath) {
  if (SUBFOLDER === '/') return fullPath;

  // Remove query string for comparison
  const pathOnly = fullPath.split('?')[0];

  if (pathOnly === SUBFOLDER.slice(0, -1) || pathOnly === SUBFOLDER) {
    return '/';
  }

  if (pathOnly.startsWith(SUBFOLDER)) {
    return pathOnly.slice(SUBFOLDER.length - 1) + (fullPath.includes('?') ? '?' + fullPath.split('?')[1] : '');
  }

  // Path doesn't match SUBFOLDER, return as-is
  return fullPath;
}

/**
 * Determine which upstream port to use for a given path (after SUBFOLDER stripping)
 */
function getUpstreamPort(path) {
  // /data and /ws routes go to Selkies WebSocket (port 8082)
  if (path.startsWith('/data') || path.startsWith('/ws')) {
    return SELKIES_WS_PORT;
  }
  // All other routes go to webtop web UI (port 3000)
  return WEBTOP_UI_PORT;
}

/**
 * Routes that should bypass authentication (after SUBFOLDER stripping)
 * Selkies WebSocket and streaming endpoints require no auth - VNC password in URL
 */
function shouldBypassAuth(path) {
  // /data/* routes are Selkies WebSocket (handles own auth)
  if (path === '/data' || path.startsWith('/data/') || path.startsWith('/data?')) {
    return true;
  }
  // /ws/* routes are WebSocket upgrade endpoints (handles own auth)
  if (path === '/ws' || path.startsWith('/ws/') || path.startsWith('/ws?')) {
    return true;
  }
  // All other routes require authentication
  return false;
}

/**
 * Check if authorization header is valid
 */
function checkAuth(authHeader) {
  if (!authHeader) {
    console.log('[kasmproxy-wrapper] Auth check: no header provided');
    return false;
  }
  const [scheme, credentials] = authHeader.split(' ');
  if (scheme !== 'Basic') {
    console.log('[kasmproxy-wrapper] Auth check: invalid scheme', scheme);
    return false;
  }

  try {
    const decoded = Buffer.from(credentials, 'base64').toString();
    const expected = 'kasm_user:' + PASSWORD;

    // Log for debugging (mask passwords)
    const decodedMask = decoded.includes(':') ? decoded.split(':')[0] + ':' + '***' : '***';
    const expectedMask = expected.split(':')[0] + ':' + '***';
    console.log('[kasmproxy-wrapper] Auth check: decoded=' + decodedMask + ', expected=' + expectedMask);

    if (decoded !== expected) {
      console.log('[kasmproxy-wrapper] Auth FAILED: password mismatch');
      return false;
    }
    console.log('[kasmproxy-wrapper] Auth SUCCESS');
    return true;
  } catch (err) {
    console.log('[kasmproxy-wrapper] Auth check error:', err.message);
    return false;
  }
}

/**
 * Get basic auth header with VNC credentials
 */
function getBasicAuth() {
  if (!PASSWORD) return null;
  const credentials = 'kasm_user:' + PASSWORD;
  const encoded = Buffer.from(credentials).toString('base64');
  return 'Basic ' + encoded;
}

// Create HTTP server
const server = http.createServer((req, res) => {
  // Strip SUBFOLDER prefix from request path
  const path = stripSubfolder(req.url);

  // Reject requests that don't match SUBFOLDER (if SUBFOLDER is set)
  if (SUBFOLDER !== '/' && !req.url.startsWith(SUBFOLDER) && req.url !== SUBFOLDER.slice(0, -1)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  // Check if this route should bypass auth
  const bypassAuth = shouldBypassAuth(path);

  // Enforce auth for protected routes
  if (PASSWORD && !bypassAuth) {
    if (!checkAuth(req.headers.authorization)) {
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="kasmproxy"',
        'Content-Type': 'text/plain'
      });
      res.end('Unauthorized');
      return;
    }
  }

  // Determine which upstream port to use
  const upstreamPort = getUpstreamPort(path);

  // Forward request to appropriate upstream
  const headers = { ...req.headers };
  delete headers.host;
  headers.host = `localhost:${upstreamPort}`;

  // Don't send auth headers to upstream services - they handle auth independently

  const options = {
    hostname: 'localhost',
    port: upstreamPort,
    path: path,
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
  // Strip SUBFOLDER prefix from request path (keep query string for upstream)
  const path = stripSubfolder(req.url);

  // Check if this route should bypass auth
  const bypassAuth = shouldBypassAuth(path);

  // Enforce auth for protected routes
  if (PASSWORD && !bypassAuth) {
    if (!checkAuth(req.headers.authorization)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="kasmproxy"\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nUnauthorized');
      socket.destroy();
      return;
    }
  }

  // Determine which upstream port to use
  const upstreamPort = getUpstreamPort(path);

  // Forward request to appropriate upstream
  const headers = { ...req.headers };
  delete headers.host;
  headers.host = `localhost:${upstreamPort}`;

  // Don't send auth headers to upstream services - they handle auth independently

  const options = {
    hostname: 'localhost',
    port: upstreamPort,
    path: path,
    method: req.method,
    headers
  };

  const proxyReq = http.request(options);

  // Handle upgrade response from upstream
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
  console.log(`[kasmproxy-wrapper] Forwarding to Webtop UI on port ${WEBTOP_UI_PORT}`);
  console.log(`[kasmproxy-wrapper] Forwarding /data and /ws to Selkies on port ${SELKIES_WS_PORT}`);
  console.log(`[kasmproxy-wrapper] Public routes: /data/*, /ws/*`);
});

server.on('error', (err) => {
  console.error('[kasmproxy-wrapper] Server error:', err);
  process.exit(1);
});
