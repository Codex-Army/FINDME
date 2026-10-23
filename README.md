# HUNT THE HIDDEN LOCATION — OSINT Investigation CTF (Goa, India Edition)

Four images, six OSINT-fundamentals questions followed by four location-identification questions, and one final flag. Dark neon-green terminal UI, server-side answer checking,
SQLite persistence, and an authenticated admin dashboard.

## Requirements
- **Node.js 22.5 or newer** (uses the built-in `node:sqlite` module).
- **No npm packages and no `npm install`.** The server uses only Node built-ins, so there is nothing that can fail to install or compile.

## Run locally (important for username login)
1. Install **Node.js 22.5 or newer**.
2. Extract the ZIP completely.
3. Open Command Prompt/PowerShell **inside the extracted `hunt-hidden-location` folder**.
4. Run:
```bash
npm start
```
5. Keep that terminal window open, then visit **http://localhost:3000** in your browser.
6. Enter a new username such as `Murad123` (3–24 letters, numbers, `_` or `-`) and click **INITIALIZE MISSION**.
7. Save the one-time resume code shown after registration.

**Do not open `public/index.html` directly** and do not use `file://...`; the username form needs the Node backend. This stateful project also will not work on a static-only Vercel deployment. Use a Node.js host for online access.

To run the test suite in a second terminal:
```bash
npm test
```
The smoke test starts its own temporary test server/database.

## Configuration (`.env`)
| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | **Required for `/admin`.** If unset, the admin console is disabled. Use a long random value. |
| `SESSION_SECRET` | Signs admin cookies. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `FLAG` | Final flag, released by the server only after all 10 questions are solved. |
| `DATA_DIR` | Folder for `hunt.db`. Point it at a persistent disk in production. |
| `PORT` | Default 3000. |
| `TRUST_PROXY` | Set `true` behind an HTTPS reverse proxy so cookies are `Secure` and rate limits see real client IPs. |

`.env` is git-ignored. Nothing secret is ever sent to the browser.

## Editing questions and answers
Edit **`config/questions.js`** (title, description, points, hint, success message, and the `accept` list).
Edit **`config/evidence.js`** for image IDs and captions. Images live in `public/images/`.
Restart the server after changes. Matching normalizes case, accents, punctuation and spacing,
and then requires an **exact** match with one of the `accept` entries (substrings are rejected).

> **Verify before the event:** location answers for Q8 (street), Q9 (church landmark) and Q10 (island) are organizer-provided and should be verified against your evidence before the event. The accepted answer strings are stored server-side in `config/questions.js`.

## Authentication model
- A username alone is not authentication. On first registration the server issues a **one-time resume code** (shown once; only a scrypt hash is stored).
- Logging in again with an existing username requires that code. This stops someone else from taking over a student's progress by typing a different capitalization of the name.
- After login, the browser receives an `HttpOnly`, `SameSite=Strict` session cookie (random token, stored hashed server-side, 14-day expiry).
- Students who lose their code cannot recover progress. The organizer can delete the row from the `students` table if needed.

## Admin dashboard
`/admin` serves only a login form. All data comes from `/api/admin/*`, which requires a signed, HttpOnly admin cookie
(8-hour expiry; login rate limited to 5 attempts per 15 minutes per IP). Features: search, sort by points/completion/activity,
filter completed/incomplete, participant / completed / ongoing / highest-score stats, auto-refresh every 10 s, and CSV export
(cells starting with `= + - @` are prefixed with `'` to prevent spreadsheet formula injection).

## Security summary
- Answer checking, scoring and flag release happen only on the server. The answer key is never sent to the client.
- Points come from a `solves` table with a `(student_id, question_id)` primary key, so a question can never score twice. The browser never supplies points.
- Rate limits: login, registration, answers, admin login (in memory; resets on restart and is per instance).
- JSON bodies only (`Content-Type` enforced), body size limits, parameterized SQL, DOM updates via `textContent`, strict CSP, `X-Frame-Options: DENY`.
- Static files are served only from `public/`; config, database and server code are not reachable.

## Deployment
This is a **stateful Node server**: it cannot run on static-only hosts (GitHub Pages, plain Netlify/Vercel static).
Use a Node host that provides a **persistent disk** (Render, Railway, Fly.io, a VPS, etc.):
1. Use Node 22.5+ and start command `npm start`.
2. Set `ADMIN_PASSWORD`, `SESSION_SECRET`, `FLAG`, `TRUST_PROXY=true`.
3. Mount a persistent volume (e.g. `/data`) and set `DATA_DIR=/data`.
4. Without a persistent disk, progress is lost on every redeploy or restart.

### Limitations
- SQLite means **one instance only**; do not scale horizontally. For multi-instance deployments, port `database/db.js` to PostgreSQL.
- Rate-limit counters are per process.
- The evidence images are screenshots; captions describe what is visible and deliberately avoid stating the location.

## Layout
```
server.js            HTTP server, static files, security headers
config/              env loading, questions.js (answer key), evidence.js
database/db.js       SQLite schema + data access (hunt.db is created on first run)
routes/              student.js (login, answers), admin.js (dashboard API)
lib/                 http helpers, rate limiting, answer normalization
public/              index.html, admin.html, style.css, app.js, admin.js, images/
test/smoke.js        end-to-end tests
```
