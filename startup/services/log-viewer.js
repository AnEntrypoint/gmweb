export default {
  name: 'log-viewer',
  type: 'web',
  requiresDesktop: false,
  dependencies: [],

  async start(env) {
    const http = require('http');
    const fs = require('fs');
    const path = require('path');

    const logsDir = '/config/logs';
    const port = 9997;

    const server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      if (req.url === '/') {
        const html = `
<!DOCTYPE html>
<html>
<head>
  <title>gmweb Log Viewer</title>
  <style>
    body { font-family: monospace; background: #1e1e1e; color: #d4d4d4; margin: 20px; }
    h1 { color: #4ec9b0; }
    a { color: #569cd6; text-decoration: none; margin: 5px 10px 5px 0; display: inline-block; }
    a:hover { text-decoration: underline; }
    .section { margin-bottom: 30px; }
    .status { padding: 10px; background: #2d2d30; margin: 10px 0; border-left: 3px solid #4ec9b0; }
  </style>
</head>
<body>
  <h1>🔍 gmweb Log Viewer</h1>

  <div class="section">
    <h2>System Logs</h2>
    <div class="status">
      <a href="/view/supervisor.log">📋 supervisor.log</a>
      <a href="/view/startup.log">📋 startup.log</a>
      <a href="/view/custom-init.log">📋 custom-init.log</a>
    </div>
  </div>

  <div class="section">
    <h2>Service Logs</h2>
    <div class="status">
      <a href="/view/services/webssh2.log">🖥️ webssh2 (ttyd)</a>
      <a href="/view/services/file-manager.log">📁 file-manager (NHFS)</a>
      <a href="/view/services/aion-ui.log">🤖 aion-ui</a>
      <a href="/view/services/opencode.log">💻 opencode</a>
    </div>
  </div>

  <div class="section">
    <h2>Debug Commands</h2>
    <div class="status">
      <a href="/debug/xfce">🖼️ XFCE Status</a>
      <a href="/debug/dbus">🔌 D-Bus Status</a>
      <a href="/debug/nginx">🌐 nginx Status</a>
    </div>
  </div>

  <hr/>
  <p style="color: #888; font-size: 12px;">Last updated: ${new Date().toISOString()}</p>
</body>
</html>
        `;
        res.end(html);
        return;
      }

      if (req.url.startsWith('/view/')) {
        const file = req.url.slice(6);
        const filePath = path.join(logsDir, file);

        if (!filePath.startsWith(logsDir)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split('\n').slice(-500);

          res.end(`
<pre style="background:#1e1e1e; color:#d4d4d4; padding:20px; overflow-x:auto;">
<a href="/">← Back to Logs</a>

<strong>${file}</strong> (last 500 lines)

${lines.join('\n')}
</pre>
          `);
        } catch (e) {
          res.statusCode = 404;
          res.end(`File not found: ${file}`);
        }
        return;
      }

      if (req.url === '/debug/xfce') {
        res.end(`<pre><a href="/">← Back</a>

XFCE Status:
ps aux | grep xfce | grep -v grep
</pre>`);
        return;
      }

      res.statusCode = 404;
      res.end('Not found');
    });

    server.listen(port, '127.0.0.1');
    return {
      pid: process.pid,
      process: null,
      cleanup: async () => { server.close(); }
    };
  },

  async health() {
    try {
      const http = require('http');
      await new Promise((resolve, reject) => {
        const req = http.get('http://127.0.0.1:9997/', (res) => {
          if (res.statusCode === 200) resolve();
          else reject();
        });
        req.on('error', reject);
        req.setTimeout(5000, () => reject());
      });
      return true;
    } catch {
      return false;
    }
  }
};
