// Notes — client. Shows every Claude project's memory notes and lets you write your own.
const CATS = [
  { type: 'project', label: 'Projects & plans' },
  { type: 'reference', label: 'Reference' },
  { type: 'feedback', label: 'How Claude should work' },
  { type: 'user', label: 'About you' },
  { type: 'idea', label: 'Ideas' },
  { type: 'other', label: 'Other' },
];
const EDITABLE_CATS = CATS.filter(c => c.type !== 'other');
const catOf = t => CATS.find(c => c.type === t) || CATS[CATS.length - 1];
const catVar = t => `var(--c-${catOf(t).type})`;

const state = { vaults: [], notes: [], query: '', editing: false, staleWhileEditing: false, graphVault: 'all' };
const $ = sel => document.querySelector(sel);

// Folded/unfolded sidebar groups, remembered per browser.
const openState = (() => { try { return JSON.parse(localStorage.getItem('notes-open')) || {}; } catch { return {}; } })();
const isOpen = (key, fallback) => (key in openState ? openState[key] : fallback);
function setOpen(key, open) {
  openState[key] = open;
  try { localStorage.setItem('notes-open', JSON.stringify(openState)); } catch {}
}

// ---------- helpers ----------
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stem = file => file.replace(/\.md$/, '');
const vaultOf = n => state.vaults.find(v => v.id === n.vault);
const vaultLabel = id => (state.vaults.find(v => v.id === id) || { label: id }).label;
function humanize(slug) {
  const s = slug.replace(/[-_]+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const titleOf = n => n.title || (/\s/.test(n.name) ? n.name : humanize(n.name));
function fmtDate(iso, withYear) {
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}
function entryDate(d) {
  const [day, to] = d.split('/');
  if (!to) return fmtDate(day, true);
  return `${Number(day.slice(8))}–${fmtDate(day.slice(0, 8) + to.padStart(2, '0'), true)}`;
}
// Resolve a [[link]]: same project first, then any project.
function findNote(target, vault) {
  const t = target.trim().toLowerCase().replace(/\.md$/, '');
  const match = n => n.name.toLowerCase() === t || stem(n.file).toLowerCase() === t;
  return state.notes.find(n => n.vault === vault && match(n)) || state.notes.find(match);
}
const noteHref = n => `#/note/${encodeURIComponent(n.vault)}/${encodeURIComponent(stem(n.file))}`;
// Links inside `code` or ``` blocks are examples, not real links.
const linksOf = n => [...n.body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '').matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1].trim());
const byNewest = (a, b) => b.modified.localeCompare(a.modified);

async function api(method, body) {
  const res = await fetch('/api/notes', {
    method, headers: { 'Content-Type': 'application/json', 'X-Notes-Client': '1' }, body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The notes server answered ${res.status}.`);
  return data;
}

// ---------- markdown ----------
function inline(text, vault) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => {
    const n = findNote(target, vault);
    const label = alias || (n ? esc(titleOf(n)) : target);
    return n
      ? `<a class="wikilink" href="${noteHref(n)}">${label}</a>`
      : `<span class="wikilink missing" title="No note called “${target}” yet">${label}</span>`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const n = url.endsWith('.md') && findNote(url, vault);
    if (n) return `<a class="wikilink" href="${noteHref(n)}">${label}</a>`;
    return /^https?:/.test(url) ? `<a href="${url}" target="_blank" rel="noopener">${label}</a>` : `${label} (${url})`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

// Lines that start with a date ("As of 2026-11-04:", "2026-11-08 correction:", ranges like 2026-11-10/11)
// become a History timeline.
const DATED = [
  /^(?:As of\s+)?(\d{4}-\d{2}-\d{2}(?:\/\d{1,2})?)(?:\s*\(([^)]*)\))?\s*:\s*/,
  /^(\d{4}-\d{2}-\d{2}(?:\/\d{1,2})?)\s+([A-Za-z][\w ]{0,24}?(?:\s*\([^)]*\))?)\s*:\s*/,
  /^As of\s+(\d{4}-\d{2}-\d{2}(?:\/\d{1,2})?)(?:\s*\(([^)]*)\))?[,\s]+/,
];
function parseBody(body) {
  const blocks = [], entries = [];
  let para = [], list = null, fence = null, lastEntry = null;
  const flushPara = () => { if (para.length) blocks.push({ kind: 'p', text: para.join(' ') }); para = []; };
  const flushList = () => { if (list) blocks.push(list); list = null; };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (fence) { if (/^```/.test(line)) { blocks.push(fence); fence = null; } else fence.text += line + '\n'; continue; }
    if (/^```/.test(line)) { flushPara(); flushList(); lastEntry = null; fence = { kind: 'pre', text: '' }; continue; }
    if (!line.trim()) { flushPara(); flushList(); lastEntry = null; continue; }
    let m = null;
    for (const re of DATED) { m = line.match(re); if (m) break; }
    if (m) {
      flushPara(); flushList();
      let rest = line.slice(m[0].length);
      rest = rest.charAt(0).toUpperCase() + rest.slice(1);
      lastEntry = { date: m[1], label: (m[2] || '').trim(), parts: [rest], order: entries.length };
      entries.push(lastEntry);
      continue;
    }
    const callout = /^\*\*(Why|How to apply):\*\*/.test(line);
    if (lastEntry && !callout) { lastEntry.parts.push(line); continue; }
    lastEntry = null;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flushPara(); flushList(); blocks.push({ kind: 'h', level: h[1].length, text: h[2] }); continue; }
    const li = line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.*)$/);
    if (li) {
      flushPara();
      const ordered = !!li[1];
      if (!list || list.ordered !== ordered) { flushList(); list = { kind: 'list', ordered, items: [] }; }
      list.items.push(li[2]);
      continue;
    }
    if (callout) { flushPara(); flushList(); blocks.push({ kind: 'callout', text: line }); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  if (fence) blocks.push(fence);
  return { blocks, entries };
}
function renderBlocks(blocks, vault) {
  return blocks.map(b => {
    if (b.kind === 'p') return `<p>${inline(b.text, vault)}</p>`;
    if (b.kind === 'callout') return `<p class="callout">${inline(b.text, vault)}</p>`;
    if (b.kind === 'h') return `<h${b.level + 1}>${inline(b.text, vault)}</h${b.level + 1}>`;
    if (b.kind === 'pre') return `<pre><code>${esc(b.text)}</code></pre>`;
    const tag = b.ordered ? 'ol' : 'ul';
    return `<${tag}>${b.items.map(i => `<li>${inline(i, vault)}</li>`).join('')}</${tag}>`;
  }).join('');
}

// ---------- sidebar ----------
function vaultsByRecent() {
  const latest = id => state.notes.filter(n => n.vault === id).map(n => n.modified).sort().pop() || '';
  // Shared always first, then projects by most recent change.
  return [...state.vaults].sort((a, b) => (b.shared ? 1 : 0) - (a.shared ? 1 : 0) || latest(b.id).localeCompare(latest(a.id)));
}
function renderTree() {
  const route = parseRoute();
  const currentVault = route.vault || (vaultsByRecent()[0] || {}).id;
  $('#tree').innerHTML = vaultsByRecent().map(v => {
    const notes = state.notes.filter(n => n.vault === v.id);
    const vKey = `v:${v.id}`;
    const cats = CATS.map(c => {
      const list = notes.filter(n => catOf(n.type).type === c.type).sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
      if (!list.length) return '';
      const cKey = `c:${v.id}:${c.type}`;
      return `<details class="group cat" data-key="${esc(cKey)}" style="--cat:${catVar(c.type)}"${isOpen(cKey, true) ? ' open' : ''}>
        <summary><span class="swatch" aria-hidden="true"></span>${c.label}<span class="count">${list.length}</span></summary>
        <ul>${list.map(n => `<li><a class="note-link" href="${noteHref(n)}"${route.vault === n.vault && route.note === stem(n.file) ? ' aria-current="page"' : ''}>${esc(titleOf(n))}</a></li>`).join('')}</ul>
      </details>`;
    }).join('');
    return `<details class="group project" data-key="${esc(vKey)}"${isOpen(vKey, v.id === currentVault) ? ' open' : ''}>
      <summary>${esc(v.label)}<span class="count">${notes.length}</span></summary>${cats || `<p class="tree-empty">No notes yet. <a href="#/new/${encodeURIComponent(v.id)}">Write one</a></p>`}</details>`;
  }).join('') || '<p class="status">No notes yet. Use New note to write the first one.</p>';
  $('#tree').querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => setOpen(d.dataset.key, d.open)));
  // "New note" starts in the project you're looking at.
  $('#nav-new').href = route.vault ? `#/new/${encodeURIComponent(route.vault)}` : '#/new';
  const view = route.view;
  $('#nav-home').toggleAttribute('aria-current', view === 'home');
  $('#nav-graph').toggleAttribute('aria-current', view === 'graph');
  $('#nav-new').toggleAttribute('aria-current', view === 'new');
  for (const id of ['#nav-home', '#nav-graph', '#nav-new']) if ($(id).hasAttribute('aria-current')) $(id).setAttribute('aria-current', 'page');
}

// ---------- views ----------
function listRows(notes, { snippet } = {}) {
  return `<ul class="recent">${notes.map(n => `<li><a href="${noteHref(n)}" style="--cat:${catVar(n.type)}">
    <span class="swatch" aria-hidden="true"></span><strong>${snippet ? snippet.title(n) : esc(titleOf(n))}</strong><time datetime="${esc(n.modified)}">${fmtDate(n.modified)}</time>
    <span class="desc">${snippet ? snippet.body(n) : esc(n.description)}</span>
    <span class="where">${esc(vaultLabel(n.vault))}</span></a></li>`).join('')}</ul>`;
}
function renderHome() {
  const notes = [...state.notes].sort(byNewest).slice(0, 40);
  $('#view').innerHTML = `<div class="home">
    <h1>Recently updated</h1>
    <p class="lead">The ${notes.length} most recently changed notes across ${state.vaults.length} projects.</p>
    ${listRows(notes)}</div>`;
  renderSide(null);
}
function renderProject(id) {
  const notes = state.notes.filter(n => n.vault === id).sort(byNewest);
  $('#view').innerHTML = `<div class="home"><h1>${esc(vaultLabel(id))}</h1>
    <p class="lead">${notes.length} notes, newest first.</p>${listRows(notes)}</div>`;
  renderSide(null);
}

function renderNote(n) {
  const { blocks, entries } = parseBody(n.body);
  const timeline = entries.length >= 2;
  const singleDated = !timeline && entries.length === 1
    ? `<p><strong>${entryDate(entries[0].date)}${entries[0].label ? ` (${esc(entries[0].label)})` : ''}:</strong> ${inline(entries[0].parts.join(' '), n.vault)}</p>` : '';
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.order - a.order);
  $('#view').innerHTML = `<article class="note" style="--cat:${catVar(n.type)}">
    <div class="note-head">
      <h1 class="note-title">${esc(titleOf(n))}</h1>
      <a class="btn btn-quiet" href="#/edit/${encodeURIComponent(n.vault)}/${encodeURIComponent(stem(n.file))}">Edit</a>
    </div>
    ${n.description ? `<p class="lead">${inline(n.description, n.vault)}</p>` : ''}
    <p class="meta"><span class="swatch" aria-hidden="true"></span><span class="cat">${catOf(n.type).label}</span><a href="#/project/${encodeURIComponent(n.vault)}">${esc(vaultLabel(n.vault))}</a><span>Updated ${fmtDate(n.modified, true)}</span></p>
    <div class="prose">${renderBlocks(blocks, n.vault)}${singleDated}</div>
    ${!n.body.trim() ? '<p class="empty-note">This note is empty. Use Edit to write it.</p>' : ''}
    ${timeline ? `<div class="timeline-head"><h2>History</h2><span class="meta">${entries.length} entries, newest first</span></div>
      <ol class="timeline prose">${sorted.map(e => `<li class="entry">
        <time datetime="${e.date.slice(0, 10)}">${entryDate(e.date)}${e.label ? `<span>${esc(e.label)}</span>` : ''}</time>
        ${e.parts.map(p => `<p>${inline(p, n.vault)}</p>`).join('')}</li>`).join('')}</ol>` : ''}
  </article>`;
  renderSide(n);
}

function renderSide(n) {
  const side = $('#side');
  if (!n) {
    side.innerHTML = `<section><h2>Projects</h2><ul>${vaultsByRecent().map(v =>
      `<li><a class="cat-row" href="#/project/${encodeURIComponent(v.id)}">${esc(v.label)}<b>${state.notes.filter(x => x.vault === v.id).length}</b></a></li>`).join('')}</ul></section>
    <section><h2>Tips</h2><p class="empty">Link notes with <code>[[note-name]]</code>. Start a line with <code>As of 2026-11-11:</code> to add it to a note's History.</p></section>`;
    return;
  }
  const out = [...new Set(linksOf(n))];
  const back = state.notes.filter(x => x !== n && linksOf(x).some(t => findNote(t, x.vault) === n));
  const item = t => {
    const target = findNote(t, n.vault);
    return target
      ? `<li><a href="${noteHref(target)}" style="--cat:${catVar(target.type)}">${esc(titleOf(target))}</a></li>`
      : `<li><span title="Not written yet">${esc(t)}</span></li>`;
  };
  side.innerHTML = `
    <section><h2>Linked from</h2>${back.length ? `<ul>${back.map(b => `<li><a href="${noteHref(b)}" style="--cat:${catVar(b.type)}">${esc(titleOf(b))}</a></li>`).join('')}</ul>` : '<p class="empty">No other note links here.</p>'}</section>
    <section><h2>Links to</h2>${out.length ? `<ul>${out.map(item).join('')}</ul>` : '<p class="empty">This note has no links.</p>'}</section>
    <section><h2>Details</h2><dl><dt>Project</dt><dd>${esc(vaultLabel(n.vault))}</dd>${n.author ? `<dt>Written by</dt><dd>${n.author === 'user' ? 'You' : esc(n.author)}</dd>` : ''}<dt>File</dt><dd>${esc(n.file)}</dd><dt>Updated</dt><dd>${fmtDate(n.modified, true)}</dd></dl></section>`;
}

function renderSearch(q) {
  const ql = q.toLowerCase();
  const mark = s => esc(s).replace(new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`);
  const snips = new Map();
  const hits = state.notes.filter(n => {
    const hay = [titleOf(n), n.description, n.body].join('\n');
    const i = hay.toLowerCase().indexOf(ql);
    if (i < 0) return false;
    const start = Math.max(0, i - 70);
    snips.set(n, (start ? '…' : '') + hay.slice(start, i + q.length + 110).replace(/\s+/g, ' ') + '…');
    return true;
  }).sort(byNewest);
  $('#view').innerHTML = `<div class="home search-results"><h1>Search</h1>
    <p class="lead">${hits.length ? `${hits.length} ${hits.length === 1 ? 'note mentions' : 'notes mention'} “${esc(q)}”.` : `No notes mention “${esc(q)}”. Try a shorter word.`}</p>
    ${listRows(hits, { snippet: { title: n => mark(titleOf(n)), body: n => mark(snips.get(n)) } })}</div>`;
  renderSide(null);
}

// ---------- editor ----------
function renderEditor(n, presetVault) {
  state.editing = true; state.staleWhileEditing = false;
  const isNew = !n;
  const vault = n ? n.vault : presetVault || 'shared';
  $('#view').innerHTML = `<form class="editor" id="editor" novalidate>
    <h1>${isNew ? 'New note' : 'Edit note'}</h1>
    <div class="row">
      <label class="field">Project
        ${isNew ? `<select name="vault">${vaultsByRecent().map(v => `<option value="${esc(v.id)}"${v.id === vault ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select>`
                : `<input value="${esc(vaultLabel(vault))}" disabled>`}
      </label>
      <label class="field">Category
        <select name="type">${EDITABLE_CATS.map(c => `<option value="${c.type}"${(n ? n.type : 'reference') === c.type ? ' selected' : ''}>${c.label}</option>`).join('')}</select>
      </label>
    </div>
    <label class="field">Title
      <input name="title" required maxlength="120" value="${n ? esc(titleOf(n)) : ''}" placeholder="e.g. Oilberry diesel line">
    </label>
    <label class="field">Summary <span class="hint">One line, shown in lists and search.</span>
      <input name="description" value="${n ? esc(n.description) : ''}" placeholder="What this note is about">
    </label>
    <label class="field">Note <span class="hint">Link other notes with [[note-name]]. Start a line with “As of 2026-11-11:” to add it to History.</span>
      <textarea name="body" rows="18" spellcheck="true">${n ? esc(n.body) : ''}</textarea>
    </label>
    <p class="form-error" id="form-error" role="alert"></p>
    <div class="actions">
      <button class="btn btn-primary" type="submit">${isNew ? 'Create note' : 'Save note'}</button>
      <a class="btn" href="${n ? noteHref(n) : '#/'}" id="cancel">Cancel</a>
      ${n ? '<button class="btn btn-danger" type="button" id="delete">Delete note</button>' : ''}
      <span class="hint keys">Ctrl+S saves, Esc cancels</span>
    </div>
  </form>`;
  renderSide(n);
  const form = $('#editor');
  const initial = new FormData(form);
  const dirty = () => [...new FormData(form)].some(([k, v]) => initial.get(k) !== v);
  const fail = msg => { $('#form-error').textContent = msg; };
  form.title.focus();

  form.onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (!data.title.trim()) { fail('Give the note a title.'); form.title.focus(); return; }
    try {
      const saved = isNew
        ? await api('POST', { ...data })
        : await api('PUT', { ...data, vault: n.vault, file: n.file, baseMtime: n.mtimeMs });
      state.editing = false;
      await loadNotes();
      location.hash = `#/note/${encodeURIComponent(saved.vault)}/${encodeURIComponent(stem(saved.file))}`;
      flash(isNew ? 'Note created' : 'Note saved');
    } catch (err) { fail(err.message); }
  };
  form.onkeydown = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); form.requestSubmit(); }
    if (e.key === 'Escape') { e.preventDefault(); $('#cancel').click(); }
  };
  $('#cancel').onclick = e => {
    if (dirty() && !confirm('Discard your changes to this note?')) { e.preventDefault(); return; }
    state.editing = false;
  };
  if (n) $('#delete').onclick = async () => {
    if (!confirm(`Delete “${titleOf(n)}”? This removes the file and Claude will forget it.`)) return;
    try {
      await api('DELETE', { vault: n.vault, file: n.file });
      state.editing = false;
      await loadNotes();
      location.hash = `#/project/${encodeURIComponent(n.vault)}`;
      flash('Note deleted');
    } catch (err) { fail(err.message); }
  };
}

// ---------- graph ----------
let graphStop = null;
function renderGraph() {
  const shown = state.graphVault === 'all' ? state.notes : state.notes.filter(n => n.vault === state.graphVault);
  $('#view').innerHTML = `<div class="home graph-page">
    <div class="graph-top"><h1>Graph</h1>
      <label class="field inline">Show
        <select id="graph-vault"><option value="all">All projects</option>${vaultsByRecent().map(v => `<option value="${esc(v.id)}"${v.id === state.graphVault ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select>
      </label></div>
    <p class="graph-legend">${CATS.filter(c => shown.some(n => catOf(n.type).type === c.type)).map(c => `<span><span class="swatch" style="--cat:${catVar(c.type)}"></span>${c.label}</span>`).join('')}</p>
    <div class="graph-wrap"><canvas id="graph" aria-label="Graph of notes and the links between them. Click a note to open it."></canvas></div></div>`;
  renderSide(null);
  $('#graph-vault').onchange = e => { state.graphVault = e.target.value; render(); };

  const css = getComputedStyle(document.documentElement);
  const color = t => css.getPropertyValue(`--c-${catOf(t).type}`).trim();
  const ink = css.getPropertyValue('--text').trim(), soft = css.getPropertyValue('--faint').trim(), muted = css.getPropertyValue('--muted').trim(), rule = '#3a3a3a';

  const nodes = shown.map(n => ({ id: `${n.vault}/${n.file}`, note: n, label: titleOf(n), color: color(n.type) }));
  const byId = new Map(nodes.map(x => [x.id, x]));
  const edges = [];
  for (const n of shown) for (const t of new Set(linksOf(n))) {
    const target = findNote(t, n.vault);
    const from = byId.get(`${n.vault}/${n.file}`);
    let node = target ? byId.get(`${target.vault}/${target.file}`) : byId.get(`missing:${n.vault}:${t}`);
    if (!node && !target) { node = { id: `missing:${n.vault}:${t}`, label: t, missing: true }; nodes.push(node); byId.set(node.id, node); }
    if (node && node !== from) edges.push([from, node]);
  }
  for (const x of nodes) x.deg = edges.filter(e => e[0] === x || e[1] === x).length;
  const many = nodes.length > 30;

  const canvas = $('#graph'), ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  const resize = () => {
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  // Seed each project's notes around its own spot so projects form clusters.
  const vids = [...new Set(nodes.map(x => (x.note ? x.note.vault : x.id.split(':')[1])))];
  nodes.forEach((x, i) => {
    const vi = vids.indexOf(x.note ? x.note.vault : x.id.split(':')[1]);
    const a = (vi / Math.max(vids.length, 1)) * Math.PI * 2;
    const cx = W / 2 + (vids.length > 1 ? Math.cos(a) * W * 0.25 : 0), cy = H / 2 + (vids.length > 1 ? Math.sin(a) * H * 0.25 : 0);
    x.x = cx + Math.cos(i) * 60; x.y = cy + Math.sin(i) * 60; x.vx = x.vy = 0;
  });

  const radius = x => (x.missing ? 4 : 5 + Math.min(x.deg, 8) * 1.1);
  const repel = many ? 5000 : 14000;
  let hover = null, drag = null, moved = false;
  function step() {
    for (const a of nodes) for (const b of nodes) {
      if (a === b) continue;
      const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 1, d = Math.sqrt(d2), f = repel / d2;
      a.vx += dx / d * f; a.vy += dy / d * f;
    }
    for (const [a, b] of edges) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - (many ? 110 : 200)) * 0.015;
      a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
    }
    for (const x of nodes) {
      x.vx += (W / 2 - x.x) * 0.002; x.vy += (H / 2 - x.y) * 0.002;
      if (x === drag) { x.vx = x.vy = 0; continue; }
      x.vx *= 0.82; x.vy *= 0.82; x.x += x.vx; x.y += x.vy;
      const r = radius(x) + 4; x.x = Math.max(r, Math.min(W - r, x.x)); x.y = Math.max(r, Math.min(H - r, x.y));
    }
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const near = x => !hover || x === hover || edges.some(([a, b]) => (a === hover && b === x) || (b === hover && a === x));
    ctx.lineWidth = 1.2;
    for (const [a, b] of edges) {
      const lit = hover && (a === hover || b === hover);
      ctx.globalAlpha = hover && !lit ? 0.3 : 1;
      ctx.strokeStyle = lit ? hover.color || ink : rule; ctx.setLineDash(b.missing ? [4, 4] : []);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const x of nodes) {
      const r = radius(x);
      ctx.globalAlpha = near(x) ? 1 : 0.25;
      ctx.beginPath(); ctx.arc(x.x, x.y, r, 0, Math.PI * 2);
      if (x.missing) { ctx.strokeStyle = soft; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]); }
      else { ctx.fillStyle = x.color; ctx.fill(); }
      // With many notes, only label the busy ones and whatever is under the mouse.
      if (!many || x === hover || (hover && near(x)) || (!hover && x.deg >= 3)) {
        ctx.fillStyle = x === hover ? ink : x.missing ? soft : muted;
        ctx.font = `${x === hover ? 600 : 400} 12.5px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.fillText(x.label, x.x, x.y + r + 15);
      }
    }
    ctx.globalAlpha = 1;
  }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ticks = 0, raf = 0;
  const loop = () => { step(); draw(); if (++ticks < 600 || drag) raf = requestAnimationFrame(loop); else raf = 0; };
  const wake = () => { ticks = Math.min(ticks, 520); if (!raf) raf = requestAnimationFrame(loop); };
  if (reduce) { for (let i = 0; i < 400; i++) step(); draw(); } else raf = requestAnimationFrame(loop);

  const at = e => { const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
    return nodes.find(x => Math.hypot(x.x - px, x.y - py) <= radius(x) + 5) || null; };
  canvas.onpointermove = e => {
    if (drag) { const r = canvas.getBoundingClientRect(); drag.x = e.clientX - r.left; drag.y = e.clientY - r.top; moved = true; reduce ? draw() : wake(); return; }
    const h = at(e); if (h !== hover) { hover = h; canvas.style.cursor = h && !h.missing ? 'pointer' : 'grab'; if (reduce || !raf) draw(); }
  };
  canvas.onpointerleave = () => { if (hover) { hover = null; if (reduce || !raf) draw(); } };
  canvas.onpointerdown = e => { drag = at(e); moved = false; if (drag) canvas.setPointerCapture(e.pointerId); };
  canvas.onpointerup = () => { const d = drag; drag = null; if (d && !moved && d.note) location.hash = noteHref(d.note); else if (!reduce) wake(); };
  window.onresize = () => { if (canvas.isConnected) { resize(); draw(); } };
  graphStop = () => { cancelAnimationFrame(raf); window.onresize = null; };
}

// ---------- routing & data ----------
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [view, vault, note] = parts;
  if (view === 'note' || view === 'edit') return { view, vault, note };
  if (view === 'project') return { view, vault };
  if (view === 'new') return { view, vault };
  if (view === 'graph') return { view };
  return { view: 'home' };
}
function render() {
  if (graphStop) { graphStop(); graphStop = null; }
  const route = parseRoute();
  if (route.view !== 'edit' && route.view !== 'new') state.editing = false;
  renderTree();
  if (state.query && !state.editing) return renderSearch(state.query);
  const n = route.note && state.notes.find(x => x.vault === route.vault && stem(x.file) === route.note);
  document.title = n ? `${titleOf(n)} – Notes` : 'Notes';
  if (route.view === 'graph') return renderGraph();
  if (route.view === 'new') return renderEditor(null, route.vault);
  if (route.view === 'project') return renderProject(route.vault);
  if (route.view === 'note' || route.view === 'edit') {
    if (n) return route.view === 'edit' ? renderEditor(n) : renderNote(n);
    $('#view').innerHTML = `<div class="empty-state"><h1>That note isn't here</h1><p>It may have been renamed or deleted. Pick a note from the list, or search for it.</p></div>`;
    return renderSide(null);
  }
  renderHome();
}
async function loadNotes() {
  const res = await fetch('/api/notes');
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  const data = await res.json();
  state.vaults = data.vaults;
  state.notes = data.notes;
}
function flash(text) {
  const s = $('#status');
  s.textContent = text;
  s.classList.add('flash');
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { s.classList.remove('flash'); s.textContent = 'Watching for changes'; }, 3000);
}

async function init() {
  await loadNotes();
  render();
  window.addEventListener('hashchange', () => {
    if (state.query) { state.query = ''; $('#search').value = ''; }
    render();
    $('#main').focus({ preventScroll: true }); $('#main').scrollTop = 0;
    $('#sidebar').classList.remove('open'); $('#menu-toggle').setAttribute('aria-expanded', 'false');
  });
  $('#search').addEventListener('input', e => { state.query = e.target.value.trim(); if (!state.editing) render(); });
  $('#menu-toggle').onclick = () => {
    const open = $('#sidebar').classList.toggle('open');
    $('#menu-toggle').setAttribute('aria-expanded', String(open));
  };
  const events = new EventSource('/api/events');
  events.addEventListener('change', async () => {
    await loadNotes();
    // Never re-render under someone who is typing; saving checks for conflicts instead.
    if (state.editing) { renderTree(); return; }
    render();
    flash(`Notes updated at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
  });
  events.onerror = () => { $('#status').textContent = 'Lost connection to the notes server. Start it again with start-notes.cmd.'; };
  events.onopen = () => { $('#status').textContent = 'Watching for changes'; };
}

init().catch(err => {
  $('#view').innerHTML = `<div class="empty-state"><h1>Can't load notes</h1><p>The notes server didn't answer (${esc(err.message)}). Start it with <code>start-notes.cmd</code> (Windows) or <code>start-notes.sh</code> (macOS, Linux) in the notes folder, then reload this page.</p></div>`;
});
