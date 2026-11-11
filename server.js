// Notes — a local viewer/editor for every Claude project's memory notes.
// Works on Windows, macOS and Linux (Node 18+). No dependencies.
// Run: node server.js  (or npm start), then open http://notes.localhost:6683
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 6683 spells NOTE on a phone keypad. Chosen to stay clear of common dev ports
// (80, 3000, 5173+, 8080) and of Windows' reserved/dynamic port ranges.
const PORT = Number(process.env.PORT) || 6683;
// Claude Code keeps its data in ~/.claude unless CLAUDE_CONFIG_DIR points elsewhere.
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PROJECTS = path.join(CLAUDE_DIR, 'projects');
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const NOTE_TYPES = ['user', 'feedback', 'project', 'reference'];
// Browsers send any *.localhost name to this PC, so http://notes.localhost:6683 needs no hosts-file edit.
const ALLOWED_HOSTS = new Set([`notes.localhost:${PORT}`, `localhost:${PORT}`, `127.0.0.1:${PORT}`]);

// ---------- project ("vault") discovery ------------------------------------
// Claude names each project folder after its working directory, with every
// non-alphanumeric character turned into "-":
//   Windows  C:\Users\me\code\my-app -> C--Users-me-code-my-app
//   macOS    /Users/me/code/my-app   -> -Users-me-code-my-app
//   Linux    /home/me/code/my-app    -> -home-me-code-my-app
const HOME_SLUG = os.homedir().replace(/[^A-Za-z0-9]/g, '-');

// Optional friendly names for projects, kept in labels.json next to this file
// (not committed; see labels.example.json). Each entry's "match" is a regular
// expression tested against the project folder name; match on the end of the
// name (with $) so the same file works on any OS.
const LABELS_FILE = path.join(__dirname, 'labels.json');
let labelsCache = { mtime: -1, list: [] };
function customLabels() {
  let mtime;
  try { mtime = fs.statSync(LABELS_FILE).mtimeMs; } catch { return []; }
  if (mtime !== labelsCache.mtime) {
    try {
      const list = JSON.parse(fs.readFileSync(LABELS_FILE, 'utf8')).map(e => [new RegExp(e.match), String(e.label)]);
      labelsCache = { mtime, list };
    } catch (e) {
      console.warn(`Ignoring labels.json: ${e.message}`);
      labelsCache = { mtime, list: [] };
    }
  }
  return labelsCache.list;
}
// Folder names that say where a project lives rather than what it is.
const NOISE = /^(?:Desktop|Documents|AppData|Roaming|Local|Library|Application-Support|coding|code|claude|projects|Projects|dev|src|repos|workspace|work|git)-+/;
function labelFor(slug, homeSlug = HOME_SLUG, labels = customLabels()) {
  for (const [re, label] of labels) if (re.test(slug)) return label;
  if (slug === homeSlug) return 'General (home folder)';
  let rest = slug;
  if (slug.startsWith(homeSlug + '-')) {
    rest = slug.slice(homeSlug.length + 1);
    while (NOISE.test(rest)) rest = rest.replace(NOISE, '');
  }
  rest = rest.replace(/-+/g, ' ').trim() || slug;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}
function discoverVaults() {
  if (!fs.existsSync(PROJECTS)) return [];
  const vaults = [];
  for (const slug of fs.readdirSync(PROJECTS)) {
    const dir = path.join(PROJECTS, slug, 'memory');
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    if (!files.some(f => f.endsWith('.md') && f !== 'MEMORY.md')) continue;
    vaults.push({ id: slug, label: labelFor(slug), dir });
  }
  return vaults;
}
const vaultById = id => discoverVaults().find(v => v.id === id);

// ---------- frontmatter ----------------------------------------------------
function unquote(raw) {
  if (/^".*"$/.test(raw)) { try { return JSON.parse(raw); } catch { /* fall through */ } }
  return raw.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}
function splitNote(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let parent = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\s*)([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, indent, key, raw] = kv;
    if (!indent && raw === '') { parent = key; meta[key] = {}; continue; }
    if (indent && parent) meta[parent][key] = unquote(raw); else { parent = null; meta[key] = unquote(raw); }
  }
  return { meta, body: text.slice(m[0].length) };
}
const yamlValue = v => (/^[\w .,()/+-]*$/.test(v) && v.trim() === v && v !== '' ? v : JSON.stringify(v));
function joinNote(meta, body) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v && typeof v === 'object') { lines.push(`${k}:`); for (const [k2, v2] of Object.entries(v)) lines.push(`  ${k2}: ${yamlValue(String(v2))}`); }
    else lines.push(`${k}: ${yamlValue(String(v))}`);
  }
  lines.push('---', '');
  return lines.join('\n') + body.trim() + '\n';
}

// ---------- MEMORY.md index -------------------------------------------------
const INDEX_LINE = /^- \[([^\]]+)\]\(([^)]+)\)\s*(?:—|--|-)?\s*(.*)$/;
function readIndex(dir) {
  try { return fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8'); } catch { return ''; }
}
function indexTitles(index) {
  const titles = {};
  for (const line of index.split(/\r?\n/)) { const m = line.match(INDEX_LINE); if (m) titles[m[2]] = m[1]; }
  return titles;
}
// Add, retitle or remove one note's line in MEMORY.md (Claude's index of notes).
function updateIndex(dir, file, entry) {
  const p = path.join(dir, 'MEMORY.md');
  const lines = readIndex(dir).split(/\r?\n/);
  const i = lines.findIndex(l => { const m = l.match(INDEX_LINE); return m && m[2] === file; });
  if (entry === null) { if (i >= 0) lines.splice(i, 1); }
  else if (i >= 0) {
    // Keep Claude's own one-line hook unless this is a note the user wrote.
    const m = lines[i].match(INDEX_LINE);
    lines[i] = `- [${entry.title}](${file}) — ${entry.replaceHook ? entry.hook : m[3] || entry.hook}`;
  } else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(`- [${entry.title}](${file}) — ${entry.hook}`);
  }
  fs.writeFileSync(p, lines.join('\n').replace(/\n*$/, '\n'));
}

// ---------- reading notes ----------------------------------------------------
function readAll() {
  const vaults = discoverVaults();
  const notes = [];
  for (const v of vaults) {
    const titles = indexTitles(readIndex(v.dir));
    for (const f of fs.readdirSync(v.dir)) {
      if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
      const full = path.join(v.dir, f);
      const stat = fs.statSync(full);
      const { meta, body } = splitNote(fs.readFileSync(full, 'utf8'));
      const md = meta.metadata || {};
      notes.push({
        vault: v.id,
        file: f,
        name: meta.name || f.replace(/\.md$/, ''),
        title: titles[f] || '',
        description: meta.description || '',
        type: NOTE_TYPES.includes(md.type || meta.type) ? (md.type || meta.type) : 'other',
        modified: [md.modified, stat.mtime.toISOString()].filter(Boolean).sort().pop(),
        mtimeMs: Math.floor(stat.mtimeMs),
        body: body.trim(),
      });
    }
  }
  return { vaults: vaults.map(v => ({ id: v.id, label: v.label, dir: v.dir })), notes };
}

// ---------- writing notes ----------------------------------------------------
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const slugify = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function checkInput(b) {
  const title = String(b.title || '').trim();
  if (!title) throw new HttpError(400, 'Give the note a title.');
  if (title.length > 120) throw new HttpError(400, 'Keep the title under 120 characters.');
  const type = NOTE_TYPES.includes(b.type) ? b.type : 'reference';
  return { title, type, description: String(b.description || '').replace(/\s+/g, ' ').trim(), body: String(b.body || '') };
}
function notePath(vault, file) {
  if (!/^[\w.-]+\.md$/.test(file) || file === 'MEMORY.md') throw new HttpError(400, 'That file name is not allowed.');
  return path.join(vault.dir, file);
}
function createNote(b) {
  const vault = vaultById(b.vault) || (b.vault && fs.existsSync(path.join(PROJECTS, b.vault, 'memory')) ? { id: b.vault, dir: path.join(PROJECTS, b.vault, 'memory') } : null);
  if (!vault) throw new HttpError(400, 'Pick a project for the note.');
  const input = checkInput(b);
  const slug = slugify(input.title) || 'note';
  const file = `${slug}.md`;
  const p = notePath(vault, file);
  if (fs.existsSync(p)) throw new HttpError(409, `A note called “${slug}” already exists in this project. Pick a different title.`);
  const meta = { name: slug, description: input.description, metadata: { type: input.type, modified: new Date().toISOString(), author: 'user' } };
  fs.writeFileSync(p, joinNote(meta, input.body));
  updateIndex(vault.dir, file, { title: input.title, hook: input.description || input.title });
  return { vault: vault.id, file };
}
function updateNote(b) {
  const vault = vaultById(b.vault);
  if (!vault) throw new HttpError(404, 'That project no longer exists.');
  const p = notePath(vault, String(b.file));
  if (!fs.existsSync(p)) throw new HttpError(404, 'This note was deleted while you were editing it.');
  if (b.baseMtime && Math.floor(fs.statSync(p).mtimeMs) !== Number(b.baseMtime)) {
    throw new HttpError(409, 'This note changed while you were editing (Claude may have updated it). Copy your text, reload the note, and edit again.');
  }
  const input = checkInput(b);
  const { meta } = splitNote(fs.readFileSync(p, 'utf8'));
  meta.description = input.description;
  if (meta.metadata && typeof meta.metadata === 'object') { meta.metadata.type = input.type; meta.metadata.modified = new Date().toISOString(); delete meta.type; }
  else { meta.type = input.type; }
  if (!meta.name) meta.name = b.file.replace(/\.md$/, '');
  fs.writeFileSync(p, joinNote(meta, input.body));
  const byUser = (meta.metadata && meta.metadata.author) === 'user';
  updateIndex(vault.dir, b.file, { title: input.title, hook: input.description || input.title, replaceHook: byUser });
  return { vault: vault.id, file: b.file };
}
function deleteNote(b) {
  const vault = vaultById(b.vault);
  if (!vault) throw new HttpError(404, 'That project no longer exists.');
  const p = notePath(vault, String(b.file));
  if (!fs.existsSync(p)) throw new HttpError(404, 'This note is already gone.');
  fs.unlinkSync(p);
  updateIndex(vault.dir, b.file, null);
  return { ok: true };
}

// ---------- live updates (Server-Sent Events) -------------------------------
const clients = new Set();
let pending = null;
function broadcast() {
  clearTimeout(pending);
  pending = setTimeout(() => { for (const res of clients) res.write('event: change\ndata: notes\n\n'); }, 200);
}
// Watch each project's memory folder directly (plain fs.watch works the same on
// Windows, macOS and Linux), and look for new projects every few seconds.
const watchers = new Map();
function watchDir(dir) {
  if (watchers.has(dir)) return;
  try {
    const w = fs.watch(dir, (_, name) => { if (!name || /\.md$/i.test(name)) broadcast(); });
    w.on('error', () => { w.close(); watchers.delete(dir); broadcast(); });
    watchers.set(dir, w);
  } catch { /* folder vanished between listing and watching; next scan retries */ }
}
function scanForProjects() {
  const before = watchers.size;
  for (const v of discoverVaults()) watchDir(v.dir);
  if (watchers.size !== before) broadcast(); // a project with notes appeared
}
function startWatching() {
  scanForProjects();
  setInterval(scanForProjects, 5000).unref();
  try { fs.watch(PROJECTS, () => setTimeout(scanForProjects, 500)); } catch { /* the interval still covers it */ }
}

// ---------- http -------------------------------------------------------------
function send(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 2e6) { reject(new HttpError(413, 'That note is too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new HttpError(400, 'Bad request.')); } });
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      // Only this page may use the API: blocks other websites and DNS-rebinding tricks.
      if (!ALLOWED_HOSTS.has(req.headers.host)) throw new HttpError(403, 'Forbidden host.');
      if (req.method !== 'GET' && req.headers['x-notes-client'] !== '1') throw new HttpError(403, 'Forbidden.');

      if (url.pathname === '/api/notes' && req.method === 'GET') return send(res, 200, readAll());
      if (url.pathname === '/api/notes' && req.method === 'POST') return send(res, 200, createNote(await readJson(req)));
      if (url.pathname === '/api/notes' && req.method === 'PUT') return send(res, 200, updateNote(await readJson(req)));
      if (url.pathname === '/api/notes' && req.method === 'DELETE') return send(res, 200, deleteNote(await readJson(req)));
      if (url.pathname === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      throw new HttpError(404, 'Not found.');
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file)) throw new HttpError(404, 'Not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.code || 500, { error: e instanceof HttpError ? e.message : 'Something went wrong on the notes server. Check notes-server.log for details.' });
  }
}

if (require.main === module) {
  http.createServer(handle).on('error', e => {
    if (e.code === 'EADDRINUSE') { console.log(`Port ${PORT} is already in use; Notes is probably already running at http://notes.localhost:${PORT}`); process.exit(0); }
    throw e;
  }).listen(PORT, '127.0.0.1', () => {
    startWatching();
    console.log(`Notes running at http://notes.localhost:${PORT} (started ${new Date().toLocaleString('en-GB')})`);
    console.log(`Reading notes from ${PROJECTS}`);
  });
}

module.exports = { labelFor, splitNote, joinNote };
