(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = async (path, body) => {
    const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    try {
      const r = await fetch(path, { credentials: 'same-origin', ...opt });
      let data = {}; try { data = await r.json(); } catch {}
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: { error: 'Cannot reach the server. Start the website with `npm start` and open http://localhost:3000 (not by opening index.html directly).', detail: String(err && err.message || err) } };
    }
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // Discourage casual image saving via right-click/drag. This is a UI deterrent, not DRM.
  const blockContextMenu = (e) => { e.preventDefault(); e.stopPropagation(); return false; };
  document.addEventListener('contextmenu', blockContextMenu, true);
  window.addEventListener('contextmenu', blockContextMenu, true);
  document.addEventListener('dragstart', (e) => { if (e.target && e.target.tagName === 'IMG') e.preventDefault(); }, true);
  document.addEventListener('selectstart', (e) => { if (e.target && e.target.tagName === 'IMG') e.preventDefault(); }, true);

  let questions = [], state = null, cardsBuilt = false;

  async function init() {
    // Show the login form immediately; a failed API request must never leave the page blank.
    showLogin();
    const [q, s] = await Promise.all([api('/api/questions'), api('/api/session')]);
    if (q.ok) {
      questions = q.data.questions || [];
      buildGallery(q.data.evidence || []);
    } else {
      const msg = $('loginMsg'); msg.className = 'msg err'; msg.textContent = q.data.error || 'Could not load the challenge. Check that the backend is running.';
    }
    if (s.ok) enter(s.data);
  }
  function showLogin() { $('loginView').hidden = false; $('mainView').hidden = true; $('logoutBtn').hidden = true; $('username').focus(); }
  function enter(st) {
    $('loginView').hidden = true; $('mainView').hidden = false; $('logoutBtn').hidden = false;
    if (!cardsBuilt) buildCards();
    render(st, true);
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('loginMsg'); msg.className = 'msg'; msg.textContent = '';
    const username = $('username').value.trim();
    if (!/^[A-Za-z0-9_-]{3,24}$/.test(username)) { msg.textContent = 'USERNAME MUST BE 3-24 CHARACTERS: LETTERS, NUMBERS, _ OR -.'; return; }
    $('loginBtn').disabled = true;
    const r = await api('/api/login', { username, code: $('code').value.trim() });
    $('loginBtn').disabled = false;
    if (!r.ok) {
      msg.textContent = r.data.error || 'LOGIN FAILED.';
      if (r.status === 0 && r.data.detail) msg.textContent += ' (' + r.data.detail + ')';
      if (r.data.needsCode) { $('codeRow').hidden = false; $('code').focus(); }
      return;
    }
    $('code').value = ''; $('codeRow').hidden = true;
    if (r.data.created && r.data.resumeCode) {
      $('codeShow').textContent = r.data.resumeCode;
      $('codeModal').hidden = false;
      $('codeCopy').onclick = () => copy(r.data.resumeCode, $('codeCopy'), 'COPY CODE');
      $('codeOk').onclick = () => { $('codeModal').hidden = true; $('codeShow').textContent = ''; };
    }
    enter(r.data.state);
  });
  $('logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', {});
    state = null; $('cards').textContent = ''; cardsBuilt = false; $('complete').hidden = true;
    $('username').value = ''; showLogin();
  });

  function buildGallery(items) {
    const g = $('gallery'); g.textContent = '';
    for (const it of items) {
      const b = el('article', 'ev');
      const preview = el('button', 'ev-preview'); preview.type = 'button'; preview.setAttribute('aria-label', `Enlarge ${it.id}`);
      const wrap = el('div', 'img'); const img = el('img'); img.src = it.src; img.alt = `${it.id}: ${it.label}`; img.loading = 'lazy'; img.draggable = false;
      wrap.append(img);
      const cap = el('figcaption'); cap.append(el('span', 'id', `${it.id} — ${it.label}`), el('span', 'cap', it.caption));
      preview.append(wrap, cap);
      preview.addEventListener('click', () => openLightbox(it));
      const actions = el('div', 'ev-actions');
      const download = el('a', 'btn ev-download', '⬇ DOWNLOAD IMAGE');
      download.href = `/download/${encodeURIComponent(it.id)}`;
      download.setAttribute('aria-label', `Download image ${it.id}`);
      download.setAttribute('download', '');
      actions.append(download);
      b.append(preview, actions);
      g.append(b);
    }
  }
  function openLightbox(it) {
    const lb = $('lightbox'); lb.querySelector('img').src = it.src; lb.querySelector('img').alt = it.label;
    lb.querySelector('p').textContent = `${it.id} — ${it.label}`; lb.hidden = false; $('lbClose').focus();
  }
  const closeLb = () => { $('lightbox').hidden = true; };
  $('lbClose').addEventListener('click', closeLb);
  $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLb(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLb(); });

  function buildCards() {
    const wrap = $('cards'); wrap.textContent = '';
    for (const q of questions) {
      const card = el('article', 'card'); card.id = 'q' + q.id; card.dataset.id = q.id;
      card.append(el('span', 'check', '✓'));
      const head = el('div', 'head'); head.append(el('span', 'num', 'Q' + String(q.id).padStart(2, '0')), el('span', 'pts', q.points + ' PTS'));
      const form = el('form', 'row'); form.autocomplete = 'off'; form.noValidate = true;
      const inp = el('input'); inp.type = 'text'; inp.maxLength = 200; inp.placeholder = 'Enter answer'; inp.spellcheck = false; inp.setAttribute('aria-label', `Answer for question ${q.id}`);
      const btn = el('button', 'btn', 'SUBMIT'); btn.type = 'submit';
      form.append(inp, btn);
      const hintBtn = el('button', 'hintbtn', 'SHOW HINT'); hintBtn.type = 'button';
      const hintBox = el('p', 'hintbox', q.hint); hintBox.hidden = true;
      hintBtn.addEventListener('click', () => { hintBox.hidden = !hintBox.hidden; hintBtn.textContent = hintBox.hidden ? 'SHOW HINT' : 'HIDE HINT'; });
      const fb = el('p', 'fb'); fb.setAttribute('role', 'status');
      const status = el('span', 'state', 'STATUS: UNSOLVED');
      card.append(head, el('h3', null, q.title), el('p', 'desc', q.description), el('p', 'fmt', 'Format: ' + q.format), form, fb, hintBtn, hintBox, status);
      form.addEventListener('submit', (e) => { e.preventDefault(); submit(q, card, inp, btn, fb); });
      wrap.append(card);
    }
    cardsBuilt = true;
  }

  async function submit(q, card, inp, btn, fb) {
    const answer = inp.value.trim();
    if (!answer) { fb.className = 'fb err'; fb.textContent = 'ENTER AN ANSWER FIRST.'; return; }
    btn.disabled = true;
    const r = await api('/api/answer', { id: q.id, answer });
    btn.disabled = false;
    if (r.status === 401) { showLogin(); return; }
    if (!r.ok) { fb.className = 'fb err'; fb.textContent = r.data.error || 'SUBMISSION FAILED.'; return; }
    if (r.data.correct) {
      fb.className = 'fb'; fb.textContent = r.data.message;
    } else {
      fb.className = 'fb err'; fb.textContent = r.data.message;
      card.classList.remove('wrong'); void card.offsetWidth; card.classList.add('wrong');
      setTimeout(() => card.classList.remove('wrong'), 1200);
    }
    render(r.data.state, false, q.id, r.data.message);
  }

  function render(st, initial, justId, msg) {
    const wasComplete = state && state.solvedCount >= state.total;
    state = st;
    $('dUser').textContent = st.username;
    $('dSolved').textContent = st.solvedCount;
    $('dPoints').textContent = st.points;
    $('dStatus').textContent = st.status;
    $('bar').style.width = st.percent + '%';
    $('pct').textContent = st.percent + '% COMPLETE';
    $('progress').setAttribute('aria-valuenow', st.percent);
    for (const q of questions) {
      const card = $('q' + q.id); if (!card) continue;
      const done = st.solved.includes(q.id);
      card.classList.toggle('solved', done);
      const inp = card.querySelector('input'), btn = card.querySelector('.btn');
      inp.disabled = done; btn.disabled = done;
      card.querySelector('.state').textContent = done ? 'STATUS: SOLVED' : 'STATUS: UNSOLVED';
      if (done) {
        const fb = card.querySelector('.fb');
        if (q.id === justId && msg) fb.textContent = msg; else if (!fb.textContent) fb.textContent = q.title.length ? 'CHECKPOINT VERIFIED.' : '';
        fb.className = 'fb';
        if (initial) inp.value = '';
      }
    }
    if (st.flag) {
      $('flagText').textContent = st.flag;
      $('complete').hidden = false;
      if (!wasComplete && !initial) $('complete').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else { $('complete').hidden = true; $('flagText').textContent = ''; }
  }

  async function copy(text, btn, label) {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); } catch {} t.remove(); }
    btn.textContent = 'COPIED ✓'; setTimeout(() => { btn.textContent = label; }, 1600);
  }
  $('copyFlag').addEventListener('click', () => copy($('flagText').textContent, $('copyFlag'), 'COPY FLAG'));

  async function loadLeaderboard() {
    const body = $('leaderboardRows');
    if (!body) return;
    try {
      const r = await api('/api/leaderboard');
      if (!r.ok) throw new Error(r.data.error || 'Unable to load leaderboard');
      const rows = r.data.leaderboard || [];
      body.textContent = '';
      if (!rows.length) {
        const tr = document.createElement('tr'), td = document.createElement('td');
        td.colSpan = 6; td.textContent = 'No investigators yet — be the first to start the mission.';
        tr.append(td); body.append(tr);
      } else {
        rows.forEach((item) => {
          const tr = document.createElement('tr');
          const add = (value, cls) => { const td = document.createElement('td'); td.textContent = value; if (cls) td.className = cls; tr.append(td); return td; };
          add('#' + item.rank, 'rank');
          add(item.username, 'username');
          add(item.solved + ' / 10');
          add(String(item.points), 'score');
          const progress = add('');
          progress.textContent = '';
          const pct = document.createElement('span'); pct.textContent = item.percent + '%';
          const bar = document.createElement('div'); bar.className = 'mini-progress';
          const fill = document.createElement('span'); fill.style.width = item.percent + '%'; bar.append(fill);
          progress.append(pct, bar);
          const status = add('');
          const pill = document.createElement('span'); pill.className = 'status-pill' + (item.status === 'COMPLETED' ? ' completed' : '');
          pill.textContent = item.status; status.append(pill);
          body.append(tr);
        });
      }
      const d = new Date(r.data.updatedAt || Date.now());
      $('leaderboardUpdated').textContent = 'LAST UPDATED ' + d.toLocaleTimeString();
    } catch (e) {
      body.textContent = '';
      const tr = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = 6; td.textContent = 'Leaderboard unavailable. Check that the server is running.';
      tr.append(td); body.append(tr);
      $('leaderboardUpdated').textContent = e.message;
    }
  }
  const refreshLeaderboard = () => loadLeaderboard();
  $('leaderboardRefresh')?.addEventListener('click', refreshLeaderboard);
  setInterval(loadLeaderboard, 10000);

  init();
  loadLeaderboard();
})();
