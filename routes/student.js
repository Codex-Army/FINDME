'use strict';
const config = require('../config');
const questions = require('../config/questions');
const evidence = require('../config/evidence');
const store = require('../database/db');
const { isCorrect } = require('../lib/match');
const { json, readJson, parseCookies, setCookie, rateLimit, clientIp } = require('../lib/http');

const USERNAME_RE = /^[A-Za-z0-9_-]{3,24}$/;
const publicQuestions = questions.map(({ id, title, description, format, points, hint }) => ({ id, title, description, format, points, hint }));

function auth(req) { return store.studentBySession(parseCookies(req).sid); }
function stateWithFlag(student) {
  const s = store.stateFor(student);
  if (s.solvedCount >= s.total) s.flag = config.flag; // server verified completion
  return s;
}

module.exports = async function studentRoutes(req, res, url) {
  const p = url.pathname;
  const ip = clientIp(req);

  if (req.method === 'GET' && p === '/api/questions') return json(res, 200, { questions: publicQuestions, evidence }), true;

  if (req.method === 'GET' && p === '/api/leaderboard') {
    const students = store.allStudents()
      .sort((a, b) => b.points - a.points || b.solved - a.solved || a.username.localeCompare(b.username))
      .map((s, i) => ({ rank: i + 1, username: s.username, points: s.points, solved: s.solved, percent: s.percent, status: s.status }));
    return json(res, 200, { leaderboard: students, updatedAt: Date.now() }), true;
  }

  if (req.method === 'GET' && p === '/api/session') {
    const st = auth(req);
    return st ? json(res, 200, stateWithFlag(st)) : json(res, 401, { error: 'NOT AUTHENTICATED' }), true;
  }

  if (req.method === 'POST' && p === '/api/login') {
    if (!rateLimit('login-ip:' + ip, 20, 10 * 60e3)) return json(res, 429, { error: 'TOO MANY ATTEMPTS — WAIT A FEW MINUTES.' }), true;
    const body = await readJson(req);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const code = typeof body.code === 'string' ? body.code.slice(0, 32) : '';
    if (!USERNAME_RE.test(username)) return json(res, 400, { error: 'USERNAME MUST BE 3-24 CHARACTERS: LETTERS, NUMBERS, _ OR -.' }), true;
    const existing = store.findByName(username);
    let studentId, resumeCode = null, created = false;
    if (!existing) {
      if (!rateLimit('register-ip:' + ip, 10, 3600e3)) return json(res, 429, { error: 'TOO MANY NEW REGISTRATIONS FROM THIS NETWORK.' }), true;
      try { const r = store.createStudent(username); studentId = r.id; resumeCode = r.code; created = true; }
      catch { return json(res, 409, { error: 'USERNAME ALREADY TAKEN.' }), true; }
    } else {
      if (!rateLimit('login-user:' + existing.id, 8, 15 * 60e3)) return json(res, 429, { error: 'TOO MANY ATTEMPTS FOR THIS USERNAME — WAIT 15 MINUTES.' }), true;
      if (!code) return json(res, 409, { error: 'USERNAME EXISTS. ENTER YOUR RESUME CODE TO CONTINUE, OR CHOOSE ANOTHER USERNAME.', needsCode: true }), true;
      if (!store.verifyCode(existing, code)) return json(res, 401, { error: 'INVALID RESUME CODE.', needsCode: true }), true;
      studentId = existing.id; store.touch(studentId);
    }
    const sess = store.createSession(studentId);
    setCookie(res, req, 'sid', sess.token, sess.ttl);
    const st = store.studentBySession(sess.token);
    return json(res, 200, { created, resumeCode, state: stateWithFlag(st) }), true;
  }

  if (req.method === 'POST' && p === '/api/logout') {
    store.destroySession(parseCookies(req).sid);
    setCookie(res, req, 'sid', '', 0);
    return json(res, 200, { ok: true }), true;
  }

  if (req.method === 'POST' && p === '/api/answer') {
    const st = auth(req);
    if (!st) return json(res, 401, { error: 'NOT AUTHENTICATED' }), true;
    if (!rateLimit('answer:' + st.id, 30, 60e3) || !rateLimit('answer-ip:' + ip, 120, 60e3))
      return json(res, 429, { error: 'SLOW DOWN — TOO MANY SUBMISSIONS.' }), true;
    const body = await readJson(req);
    const qid = Number(body.id);
    const question = Number.isInteger(qid) ? questions.find((x) => x.id === qid) : null;
    if (!question) return json(res, 400, { error: 'UNKNOWN QUESTION.' }), true;
    if (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.length > 200)
      return json(res, 400, { error: 'ENTER AN ANSWER (MAX 200 CHARACTERS).' }), true;
    const correct = isCorrect(question, body.answer);
    const r = store.submit(st, question, body.answer.trim(), correct);
    if (r.alreadySolved) return json(res, 200, { correct: true, alreadySolved: true, message: 'ALREADY SOLVED — NO ADDITIONAL POINTS.', state: stateWithFlag(st) }), true;
    return json(res, 200, {
      correct,
      message: correct ? question.success : 'INCORRECT — RECHECK YOUR EVIDENCE.',
      state: stateWithFlag(st)
    }), true;
  }
  return false;
};
