'use strict';
// End-to-end smoke test: spawns the server on a temp DB and exercises the checklist.
const { spawn } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const questions = require('../config/questions');
const PORT = 3900 + Math.floor(Math.random() * 90);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hunt-'));
const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_PASSWORD: 'test-admin-pw', SESSION_SECRET: 'x'.repeat(32), FLAG: 'FLAG{TEST_ONLY}' };
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')], { env, stdio: 'pipe' });
const base = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function client() {
  let cookies = {};
  return async (p, body, extra = {}) => {
    const headers = { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    const r = await fetch(base + p, { method: body !== undefined ? 'POST' : 'GET', headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual', ...extra });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) cookies[kv.slice(0, i)] = v; else delete cookies[kv.slice(0, i)]; }
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, headers: r.headers };
  };
}
let passed = 0; const ok = (name) => { passed++; console.log('  ✓', name); };
(async () => {
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/healthz'); break; } catch { await sleep(100); } }
  const a = client();
  // pages + images
  for (const p of ['/', '/admin', '/style.css', '/app.js', '/images/image1.png', '/images/image2.png', '/images/image3.png', '/images/image4.jpg']) {
    const r = await a(p); assert.strictEqual(r.status, 200, p);
  }
  ok('pages, assets and all four images load');
  assert.strictEqual((await a('/../server.js')).status, 404); assert.strictEqual((await a('/%2e%2e/server.js')).status, 404);
  assert.strictEqual((await a('/config/questions.js')).status, 404);
  ok('path traversal / config files not served');
  const q = await a('/api/questions'); assert.strictEqual(q.json.questions.length, 10);
  assert.ok(!/"accept"|Sancoale|Rue De Maria|Jacinto|Panaji|FLAG\{/i.test(q.text)); ok('10 questions listed; no answer key or flag in public API');
  const htmlJs = (await a('/app.js')).text + (await a('/')).text; assert.ok(!/Sancoale|Panaji|FLAG\{|Jacinto/i.test(htmlJs)); ok('no answers/flag in HTML or client JS');
  // login
  assert.strictEqual((await a('/api/login', { username: 'a!' })).status, 400);
  const l = await a('/api/login', { username: 'Cyber_Fox' }); assert.strictEqual(l.status, 200); assert.ok(l.json.resumeCode);
  const code = l.json.resumeCode;
  const imp = client(); const l2 = await imp('/api/login', { username: 'cyber_FOX' }); assert.strictEqual(l2.status, 409);
  const l3 = await imp('/api/login', { username: 'cyber_FOX', code: 'AAAA-AAAA' }); assert.strictEqual(l3.status, 401);
  assert.strictEqual((await imp('/api/session')).status, 401); ok('username unique case-insensitively; no takeover without resume code');
  // answers
  const wrong = await a('/api/answer', { id: 1, answer: 'Mumbai' });
  assert.strictEqual(wrong.json.correct, false); assert.strictEqual(wrong.json.state.points, 0); assert.ok(!JSON.stringify(wrong.json).includes('Panaji')); ok('wrong answer: no points, answer not revealed');
  assert.strictEqual((await a('/api/answer', { id: 1, answer: 'Pan' })).json.correct, false);
  assert.strictEqual((await a('/api/answer', { id: 1, answer: 'not Panaji at all' })).json.correct, false); ok('partial / substring answers rejected');
  const variants = { 1: 'Open Source Intelligence', 2: 'publicly available information', 3: 'Question', 4: 'site:', 5: 'Google Lens', 6: 'two', 7: 'PaNaJi', 8: '  rue de maria road ', 9: 'FRONTISPIECE OF SANCOALE', 10: 'SÃO JACINTO ISLAND' };
  const r1 = await a('/api/answer', { id: 1, answer: variants[1] }); assert.ok(r1.json.correct); assert.strictEqual(r1.json.state.points, 100); assert.strictEqual(r1.json.message, 'CORRECT — OSINT DECODED.');
  const dup = await a('/api/answer', { id: 1, answer: 'panaji' }); assert.strictEqual(dup.json.state.points, 100); assert.ok(dup.json.alreadySolved); ok('case-insensitive match; points awarded once only');
  const flagless = await a('/api/session'); assert.ok(!('flag' in flagless.json)); assert.ok(!flagless.text.includes('FLAG')); ok('flag hidden before completion');
  // persistence via new session w/ resume code
  const b = client(); const rl = await b('/api/login', { username: 'CYBER_FOX', code: code.toLowerCase() }); assert.strictEqual(rl.status, 200);
  assert.strictEqual(rl.json.state.points, 100); assert.deepStrictEqual(rl.json.state.solved, [1]); ok('progress persists and resumes with code');
  // solve rest
  let last; for (const qq of questions) { if (qq.id === 1) continue; last = await a('/api/answer', { id: qq.id, answer: variants[qq.id] }); assert.ok(last.json.correct, 'Q' + qq.id); }
  assert.strictEqual(last.json.state.points, 1150); assert.strictEqual(last.json.state.status, 'COMPLETED'); assert.strictEqual(last.json.state.flag, 'FLAG{TEST_ONLY}'); ok('all 10 solved: 1150 points, COMPLETED, flag released');
  // csrf-ish
  assert.strictEqual((await a('/api/answer', undefined, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 401);
  // second student incomplete
  const c = client(); await c('/api/login', { username: 'learner-2' }); await c('/api/answer', { id: 8, answer: 'india' });
  // admin
  const anon = client(); assert.strictEqual((await anon('/api/admin/students')).status, 401); assert.strictEqual((await anon('/api/admin/export.csv')).status, 401);
  assert.strictEqual((await anon('/api/admin/login', { password: 'nope' })).status, 401); ok('admin API requires authentication');
  assert.strictEqual((await a('/api/admin/students')).status, 401); ok('student session is not an admin session');
  assert.strictEqual((await anon('/api/admin/login', { password: 'test-admin-pw' })).status, 200);
  const st = await anon('/api/admin/students'); assert.strictEqual(st.json.stats.participants, 2); assert.strictEqual(st.json.stats.completed, 1); assert.strictEqual(st.json.stats.ongoing, 1); assert.strictEqual(st.json.stats.highScore, 1150);
  const csv = await anon('/api/admin/export.csv'); assert.ok(csv.text.startsWith('username,start_time')); assert.ok(!csv.text.includes('code')); ok('admin dashboard data + CSV export');
  // rate limit
  const rl2 = client(); await rl2('/api/login', { username: 'spammer' }); let limited = false;
  for (let i = 0; i < 40; i++) { const r = await rl2('/api/answer', { id: 2, answer: 'x' + i }); if (r.status === 429) { limited = true; break; } }
  assert.ok(limited); ok('answer submissions are rate limited');
  console.log(`\nAll ${passed} checks passed.`);
})().catch((e) => { console.error('\nFAILED:', e); process.exitCode = 1; }).finally(() => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
