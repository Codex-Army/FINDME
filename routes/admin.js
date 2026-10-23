'use strict';
const crypto = require('crypto');
const config = require('../config');
const store = require('../database/db');
const { json, readJson, parseCookies, setCookie, rateLimit, clientIp, safeEqual } = require('../lib/http');

const TTL = 8 * 3600; // seconds
const sign = (payload) => crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
function issueToken() { const exp = String(Date.now() + TTL * 1000); return `${exp}.${sign('admin.' + exp)}`; }
function validToken(tok) {
  if (!tok || typeof tok !== 'string') return false;
  const [exp, mac] = tok.split('.');
  if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(mac, sign('admin.' + exp));
}
const isAdmin = (req) => !!config.adminPassword && validToken(parseCookies(req).aid);

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralize spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const iso = (t) => (t ? new Date(t).toISOString() : '');

module.exports = async function adminRoutes(req, res, url) {
  const p = url.pathname;
  if (!p.startsWith('/api/admin/')) return false;

  if (req.method === 'POST' && p === '/api/admin/login') {
    if (!config.adminPassword) return json(res, 503, { error: 'ADMIN DISABLED: SET ADMIN_PASSWORD ON THE SERVER.' }), true;
    if (!rateLimit('admin-login:' + clientIp(req), 5, 15 * 60e3)) return json(res, 429, { error: 'TOO MANY ATTEMPTS — WAIT 15 MINUTES.' }), true;
    const body = await readJson(req);
    if (typeof body.password !== 'string' || !safeEqual(body.password, config.adminPassword)) return json(res, 401, { error: 'ACCESS DENIED.' }), true;
    setCookie(res, req, 'aid', issueToken(), TTL);
    return json(res, 200, { ok: true }), true;
  }
  if (req.method === 'POST' && p === '/api/admin/logout') { setCookie(res, req, 'aid', '', 0); return json(res, 200, { ok: true }), true; }

  if (!isAdmin(req)) return json(res, 401, { error: 'ADMIN AUTHENTICATION REQUIRED.' }), true;

  if (req.method === 'GET' && p === '/api/admin/students') {
    const students = store.allStudents();
    const completed = students.filter((s) => s.status === 'COMPLETED').length;
    return json(res, 200, {
      students,
      stats: {
        participants: students.length, completed,
        ongoing: students.filter((s) => s.status === 'IN PROGRESS').length,
        highScore: students.reduce((m, s) => Math.max(m, s.points), 0),
        maxPoints: store.MAX_POINTS
      }
    }), true;
  }
  if (req.method === 'GET' && p === '/api/admin/export.csv') {
    const head = ['username', 'start_time', 'last_activity', 'questions_solved', 'total_points', 'completion_percent', 'status', 'completion_time'];
    const lines = [head.join(',')].concat(store.allStudents().map((s) =>
      [s.username, iso(s.startedAt), iso(s.lastActivity), s.solved, s.points, s.percent, s.status, iso(s.completedAt)].map(csvCell).join(',')));
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="students.csv"', 'Cache-Control': 'no-store' });
    return res.end(lines.join('\r\n') + '\r\n'), true;
  }
  return json(res, 404, { error: 'NOT FOUND' }), true;
};
module.exports.isAdmin = isAdmin;
