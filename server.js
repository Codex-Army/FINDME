'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
require('./database/db');
const studentRoutes = require('./routes/student');
const adminRoutes = require('./routes/admin');
const { json } = require('./lib/http');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const SECURITY = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer'
};

function serveFile(res, file, cache) {
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { error: 'NOT FOUND' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': cache });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY)) res.setHeader(k, v);
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if (p.startsWith('/api/')) {
      if (await adminRoutes(req, res, url)) return;
      if (await studentRoutes(req, res, url)) return;
      return json(res, 404, { error: 'NOT FOUND' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'METHOD NOT ALLOWED' });
    if (p === '/' ) return serveFile(res, path.join(PUBLIC, 'index.html'), 'no-cache');
    if (p === '/admin' || p === '/admin/') return serveFile(res, path.join(PUBLIC, 'admin.html'), 'no-store');
    if (p === '/healthz') return json(res, 200, { ok: true });
    // Explicit allow-listed image download endpoint (forces an attachment download).
    const downloadMatch = p.match(/^\/download\/(IMG_00[1-4])$/);
    if (downloadMatch) {
      const files = { IMG_001: 'image1.png', IMG_002: 'image2.png', IMG_003: 'image3.png', IMG_004: 'image4.jpg' };
      const filename = files[downloadMatch[1]];
      const fullPath = path.join(PUBLIC, 'images', filename);
      return fs.readFile(fullPath, (err, buf) => {
        if (err) return json(res, 404, { error: 'IMAGE NOT FOUND' });
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(filename)] || 'application/octet-stream',
          'Content-Length': buf.length,
          'Content-Disposition': `attachment; filename=\"${filename}\"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(buf);
      });
    }
    const rel = decodeURIComponent(p);
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC + path.sep) || rel.includes('\0') || path.basename(file) === 'admin.html' || path.basename(file) === 'index.html')
      return json(res, 404, { error: 'NOT FOUND' });
    return serveFile(res, file, 'public, max-age=3600');
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { error: status === 500 ? 'SERVER ERROR' : e.message });
  }
});

server.listen(config.port, () => {
  console.log(`HUNT THE HIDDEN LOCATION listening on http://localhost:${config.port}`);
  if (!config.adminPassword) console.warn('WARNING: ADMIN_PASSWORD not set — /admin is disabled.');
  if (config.sessionSecretIsEphemeral) console.warn('WARNING: SESSION_SECRET not set — admin sessions reset on every restart.');
});
