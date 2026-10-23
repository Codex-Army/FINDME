(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let data = [], timer = null;
  const post = (p, b) => fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
  const fmt = (t) => (t ? new Date(t).toLocaleString() : '—');

  async function load() {
    const r = await fetch('/api/admin/students', { credentials: 'same-origin' });
    if (r.status === 401) { show(false); return false; }
    const j = await r.json();
    data = j.students;
    $('sP').textContent = j.stats.participants; $('sC').textContent = j.stats.completed;
    $('sO').textContent = j.stats.ongoing; $('sH').textContent = j.stats.highScore + ' / ' + j.stats.maxPoints;
    $('upd').textContent = 'Updated ' + new Date().toLocaleTimeString();
    draw(); show(true); return true;
  }
  function show(ok) {
    $('login').hidden = ok; $('dash').hidden = !ok; $('out').hidden = !ok;
    clearInterval(timer); if (ok) timer = setInterval(load, 10000);
  }
  function draw() {
    const q = $('search').value.trim().toLowerCase(), f = $('filter').value, s = $('sort').value;
    let rows = data.filter((r) => r.username.toLowerCase().includes(q) &&
      (f === 'all' || (f === 'completed' ? r.status === 'COMPLETED' : r.status !== 'COMPLETED')));
    const by = { points: (a, b) => b.points - a.points || a.username.localeCompare(b.username),
      completion: (a, b) => b.percent - a.percent || b.points - a.points,
      recent: (a, b) => b.lastActivity - a.lastActivity, name: (a, b) => a.username.localeCompare(b.username) }[s];
    rows.sort(by);
    const tb = $('rows'); tb.textContent = '';
    if (!rows.length) { const tr = document.createElement('tr'), td = document.createElement('td'); td.colSpan = 8; td.textContent = 'No matching students.'; tr.append(td); tb.append(tr); return; }
    for (const r of rows) {
      const tr = document.createElement('tr');
      const cells = [r.username, fmt(r.startedAt), fmt(r.lastActivity), r.solved + '/10', r.points, r.percent + '%'];
      for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.append(td); }
      const st = document.createElement('td'), pill = document.createElement('span');
      pill.className = 'pill ' + r.status.replace(' ', ''); pill.textContent = r.status; st.append(pill); tr.append(st);
      const ct = document.createElement('td'); ct.textContent = fmt(r.completedAt); tr.append(ct);
      tb.append(tr);
    }
  }
  $('lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await post('/api/admin/login', { password: $('pw').value });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('lm').textContent = j.error || 'ACCESS DENIED.'; return; }
    $('pw').value = ''; $('lm').textContent = ''; load();
  });
  $('out').addEventListener('click', async () => { await post('/api/admin/logout'); show(false); });
  $('refresh').addEventListener('click', load);
  for (const id of ['search', 'filter', 'sort']) $(id).addEventListener('input', draw);
  load();
})();
