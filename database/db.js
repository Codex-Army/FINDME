'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');
const questions = require('../config/questions');

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'hunt.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  code_salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL,
  answer TEXT NOT NULL,
  correct INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS solves (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL,
  points INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (student_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id);
`);

const TOTAL = questions.length;
const MAX_POINTS = questions.reduce((s, q) => s + q.points, 0);
const SESSION_TTL = 14 * 24 * 3600; // seconds
const q = (sql) => db.prepare(sql);
const now = () => Date.now();

function hashCode(code, salt) { return crypto.scryptSync(code, salt, 32).toString('hex'); }
function newResumeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = () => A[crypto.randomInt(A.length)];
  return Array.from({ length: 4 }, pick).join('') + '-' + Array.from({ length: 4 }, pick).join('');
}
function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function findByName(username) {
  return q('SELECT * FROM students WHERE username_lower = ?').get(username.toLowerCase());
}
function createStudent(username) {
  const code = newResumeCode();
  const salt = crypto.randomBytes(16).toString('hex');
  const t = now();
  const r = q('INSERT INTO students (username, username_lower, code_salt, code_hash, started_at, last_activity) VALUES (?,?,?,?,?,?)')
    .run(username, username.toLowerCase(), salt, hashCode(normCode(code), salt), t, t);
  return { id: Number(r.lastInsertRowid), code };
}
function verifyCode(student, code) {
  const a = Buffer.from(hashCode(normCode(code), student.code_salt), 'hex');
  const b = Buffer.from(student.code_hash, 'hex');
  return crypto.timingSafeEqual(a, b);
}
function createSession(studentId) {
  const token = crypto.randomBytes(32).toString('hex');
  const th = crypto.createHash('sha256').update(token).digest('hex');
  q('INSERT INTO sessions (token_hash, student_id, expires_at) VALUES (?,?,?)').run(th, studentId, now() + SESSION_TTL * 1000);
  return { token, ttl: SESSION_TTL };
}
function studentBySession(token) {
  if (!token) return null;
  const th = crypto.createHash('sha256').update(String(token)).digest('hex');
  return q(`SELECT s.* FROM sessions x JOIN students s ON s.id = x.student_id WHERE x.token_hash = ? AND x.expires_at > ?`).get(th, now()) || null;
}
function destroySession(token) {
  if (!token) return;
  q('DELETE FROM sessions WHERE token_hash = ?').run(crypto.createHash('sha256').update(String(token)).digest('hex'));
}
function touch(id) { q('UPDATE students SET last_activity = ? WHERE id = ?').run(now(), id); }

function statusOf(solvedCount, attempted) {
  if (solvedCount >= TOTAL) return 'COMPLETED';
  return solvedCount > 0 || attempted > 0 ? 'IN PROGRESS' : 'NOT STARTED';
}
function stateFor(student) {
  const solved = q('SELECT question_id, points FROM solves WHERE student_id = ? ORDER BY question_id').all(student.id);
  const attempted = q('SELECT COUNT(DISTINCT question_id) AS n FROM attempts WHERE student_id = ?').get(student.id).n;
  const points = solved.reduce((s, r) => s + r.points, 0);
  return {
    username: student.username,
    solved: solved.map((r) => r.question_id),
    solvedCount: solved.length,
    total: TOTAL,
    points, maxPoints: MAX_POINTS,
    percent: Math.round((solved.length / TOTAL) * 100),
    status: statusOf(solved.length, attempted)
  };
}

/** Records an attempt; awards points exactly once (PRIMARY KEY on solves). */
function submit(student, question, answer, correct) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const t = now();
    const already = q('SELECT 1 FROM solves WHERE student_id = ? AND question_id = ?').get(student.id, question.id);
    if (already) { db.exec('COMMIT'); return { alreadySolved: true }; }
    q('INSERT INTO attempts (student_id, question_id, answer, correct, at) VALUES (?,?,?,?,?)').run(student.id, question.id, answer.slice(0, 200), correct ? 1 : 0, t);
    if (correct) {
      q('INSERT OR IGNORE INTO solves (student_id, question_id, points, at) VALUES (?,?,?,?)').run(student.id, question.id, question.points, t);
      const n = q('SELECT COUNT(*) AS n FROM solves WHERE student_id = ?').get(student.id).n;
      if (n >= TOTAL) q('UPDATE students SET completed_at = ? WHERE id = ? AND completed_at IS NULL').run(t, student.id);
    }
    q('UPDATE students SET last_activity = ? WHERE id = ?').run(t, student.id);
    db.exec('COMMIT');
    return { alreadySolved: false };
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

function allStudents() {
  const rows = q(`
    SELECT s.id, s.username, s.started_at, s.last_activity, s.completed_at,
      (SELECT COUNT(*) FROM solves v WHERE v.student_id = s.id) AS solved_count,
      (SELECT COALESCE(SUM(points),0) FROM solves v WHERE v.student_id = s.id) AS points,
      (SELECT COUNT(*) FROM attempts a WHERE a.student_id = s.id) AS attempts
    FROM students s ORDER BY s.id`).all();
  return rows.map((r) => ({
    username: r.username, startedAt: r.started_at, lastActivity: r.last_activity,
    solved: r.solved_count, points: r.points, attempts: r.attempts,
    percent: Math.round((r.solved_count / TOTAL) * 100),
    status: statusOf(r.solved_count, r.attempts),
    completedAt: r.completed_at
  }));
}
setInterval(() => { try { q('DELETE FROM sessions WHERE expires_at < ?').run(now()); } catch {} }, 3600e3).unref();

module.exports = { db, TOTAL, MAX_POINTS, findByName, createStudent, verifyCode, createSession, studentBySession, destroySession, touch, stateFor, submit, allStudents };
