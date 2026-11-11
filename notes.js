// The note store: finds notebooks ("vaults"), reads and writes notes, searches them.
// Used by both the website API (server.js) and the MCP tools (mcp.js), so they behave the same.
const fs = require('fs');
const path = require('path');
const os = require('os');

// Claude Code keeps its data in ~/.claude unless CLAUDE_CONFIG_DIR points elsewhere.
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PROJECTS = path.join(CLAUDE_DIR, 'projects');
// The Shared notebook isn't tied to any Claude project; every agent can use it.
const SHARED_DIR = process.env.NOTES_HOME || path.join(os.homedir(), '.claude-notes', 'shared');
const SHARED_ID = 'shared';
const NOTE_TYPES = ['user', 'feedback', 'project', 'reference', 'idea'];

class NoteError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// ---------- notebook discovery ---------------------------------------------
// Claude names each project folder after its working directory, with every
// non-alphanumeric character turned into "-":
//   Windows  C:\Users\me\code\my-app -> C--Users-me-code-my-app
//   macOS    /Users/me/code/my-app   -> -Users-me-code-my-app
//   Linux    /home/me/code/my-app    -> -home-me-code-my-app
const toSlug = p => p.replace(/[^A-Za-z0-9]/g, '-');
const HOME_SLUG = toSlug(os.homedir());

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

function ensureShared() { fs.mkdirSync(SHARED_DIR, { recursive: true }); }

// Shared first, then every Claude project that has at least one note.
function discoverVaults() {
  const vaults = [{ id: SHARED_ID, label: 'Shared', dir: SHARED_DIR, shared: true }];
  let slugs = [];
  try { slugs = fs.readdirSync(PROJECTS); } catch { /* Claude Code not set up yet */ }
  for (const slug of slugs) {
    const dir = path.join(PROJECTS, slug, 'memory');
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    if (!files.some(f => f.endsWith('.md') && f !== 'MEMORY.md')) continue;
    vaults.push({ id: slug, label: labelFor(slug), dir });
  }
  return vaults;
}
const vaultById = id => discoverVaults().find(v => v.id === id);

// Accepts a notebook id, its name ("Shared", "My app"), or a project folder path.
// Empty means Shared.
function resolveProject(p) {
  const want = String(p || '').trim();
  if (!want || want.toLowerCase() === SHARED_ID) return vaultById(SHARED_ID);
  const vaults = discoverVaults();
  const found = vaults.find(v => v.id === want) || vaults.find(v => v.label.toLowerCase() === want.toLowerCase());
  if (found) return found;
  // A folder path: map it to Claude's project folder (it may have no notes yet).
  const slug = path.isAbsolute(want) ? toSlug(path.resolve(want)) : want;
  if (fs.existsSync(path.join(PROJECTS, slug))) return { id: slug, label: labelFor(slug), dir: path.join(PROJECTS, slug, 'memory') };
  const names = vaults.map(v => `"${v.label}"`).join(', ');
  throw new NoteError(404, `No notebook called "${want}". Use one of: ${names}, or the full path of a folder you've used Claude Code in.`);
}

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
    // Keep Claude's own one-line hook on notes Claude's memory wrote; replace it on notes written here.
    const m = lines[i].match(INDEX_LINE);
    lines[i] = `- [${entry.title}](${file}) — ${entry.replaceHook ? entry.hook : m[3] || entry.hook}`;
  } else {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(`- [${entry.title}](${file}) — ${entry.hook}`);
  }
  fs.writeFileSync(p, lines.join('\n').replace(/\n*$/, '\n'));
}

// ---------- reading ----------------------------------------------------------
const stem = file => file.replace(/\.md$/, '');
const noteId = n => `${n.vault}/${stem(n.file)}`;
const titleOf = n => n.title || (/\s/.test(n.name) ? n.name : n.name.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase()));

function readAll() {
  const vaults = discoverVaults();
  const notes = [];
  for (const v of vaults) {
    let files;
    try { files = fs.readdirSync(v.dir); } catch { continue; }
    const titles = indexTitles(readIndex(v.dir));
    for (const f of files) {
      if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
      const full = path.join(v.dir, f);
      let stat, text;
      try { stat = fs.statSync(full); text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      const { meta, body } = splitNote(text);
      const md = meta.metadata || {};
      const type = md.type || meta.type;
      notes.push({
        vault: v.id,
        file: f,
        name: meta.name || stem(f),
        title: titles[f] || '',
        description: meta.description || '',
        type: NOTE_TYPES.includes(type) ? type : 'other',
        author: md.author || '',
        modified: [md.modified, stat.mtime.toISOString()].filter(Boolean).sort().pop(),
        mtimeMs: Math.floor(stat.mtimeMs),
        body: body.trim(),
      });
    }
  }
  return { vaults: vaults.map(v => ({ id: v.id, label: v.label, dir: v.dir, shared: !!v.shared })), notes };
}

// Links inside `code` or ``` blocks are examples, not real links.
const linksOf = body => [...body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '').matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(m => m[1].trim());
function findByLink(notes, target, vault) {
  const t = target.trim().toLowerCase().replace(/\.md$/, '');
  const match = n => n.name.toLowerCase() === t || stem(n.file).toLowerCase() === t;
  return notes.find(n => n.vault === vault && match(n)) || notes.find(match);
}
function findById(notes, id) {
  const s = String(id || '').trim().replace(/\.md$/, '');
  const i = s.indexOf('/');
  if (i < 0) throw new NoteError(400, `"${s}" isn't a note id. Ids look like "shared/my-note"; get them from search_notes or list_recent.`);
  const n = notes.find(x => x.vault === s.slice(0, i) && stem(x.file) === s.slice(i + 1));
  if (!n) throw new NoteError(404, `No note with id "${s}". It may have been renamed or deleted; search for it instead.`);
  return n;
}

function getNote(id) {
  const { vaults, notes } = readAll();
  const n = findById(notes, id);
  const links = [...new Set(linksOf(n.body))].map(t => { const x = findByLink(notes, t, n.vault); return x ? { id: noteId(x), title: titleOf(x) } : { missing: t }; });
  const backlinks = notes.filter(x => x !== n && linksOf(x.body).some(t => findByLink(notes, t, x.vault) === n)).map(x => ({ id: noteId(x), title: titleOf(x) }));
  return { ...summary(n, vaults), body: n.body, links, backlinks };
}
function summary(n, vaults) {
  const v = vaults.find(x => x.id === n.vault);
  return { id: noteId(n), title: titleOf(n), summary: n.description, category: n.type, project: v ? v.label : n.vault, updated: n.modified, author: n.author || undefined };
}

// Words in the query must all appear somewhere (title, summary or text); title hits rank highest.
function searchNotes({ query = '', project, category, limit = 10 } = {}) {
  const { vaults, notes } = readAll();
  let pool = notes;
  if (project) { const v = resolveProject(project); pool = pool.filter(n => n.vault === v.id); }
  if (category) {
    if (!NOTE_TYPES.includes(category)) throw new NoteError(400, `Unknown category "${category}". Use one of: ${NOTE_TYPES.join(', ')}.`);
    pool = pool.filter(n => n.type === category);
  }
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const max = Math.max(1, Math.min(Number(limit) || 10, 50));
  const byNewest = (a, b) => b.n.modified.localeCompare(a.n.modified);
  if (!words.length) return pool.map(n => ({ n, score: 0 })).sort(byNewest).slice(0, max).map(({ n }) => summary(n, vaults));
  const scored = pool.map(n => {
    const t = titleOf(n).toLowerCase(), d = n.description.toLowerCase(), b = n.body.toLowerCase();
    let score = 0;
    for (const w of words) {
      const s = (t.includes(w) ? 6 : 0) + (d.includes(w) ? 3 : 0) + Math.min(b.split(w).length - 1, 5);
      if (!s) return null;
      score += s;
    }
    return { n, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score || byNewest(a, b)).slice(0, max);
  return scored.map(({ n }) => {
    const b = n.body, i = b.toLowerCase().indexOf(words[0]);
    const snippet = i < 0 ? b.slice(0, 160) : (i > 60 ? '…' : '') + b.slice(Math.max(0, i - 60), i + 140).replace(/\s+/g, ' ') + '…';
    return { ...summary(n, vaults), snippet };
  });
}

function listProjects() {
  const { vaults, notes } = readAll();
  return vaults.map(v => ({ id: v.id, name: v.label, notes: notes.filter(n => n.vault === v.id).length, shared: !!v.shared }));
}

// ---------- writing -----------------------------------------------------------
const slugify = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
function checkInput(b) {
  const title = String(b.title || '').trim();
  if (!title) throw new NoteError(400, 'Give the note a title.');
  if (title.length > 120) throw new NoteError(400, 'Keep the title under 120 characters.');
  if (b.type && !NOTE_TYPES.includes(b.type)) throw new NoteError(400, `Unknown category "${b.type}". Use one of: ${NOTE_TYPES.join(', ')}.`);
  return { title, type: b.type || 'reference', description: String(b.description || '').replace(/\s+/g, ' ').trim(), body: String(b.body || '') };
}
function notePath(vault, file) {
  if (!/^[\w.-]+\.md$/.test(file) || file === 'MEMORY.md') throw new NoteError(400, 'That file name is not allowed.');
  return path.join(vault.dir, file);
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// b: { vault (id, name or folder path; empty = Shared), title, description, type, body }
function createNote(b, author = 'user') {
  const vault = resolveProject(b.vault);
  const input = checkInput(b);
  const slug = slugify(input.title) || 'note';
  const file = `${slug}.md`;
  fs.mkdirSync(vault.dir, { recursive: true });
  const p = notePath(vault, file);
  if (fs.existsSync(p)) throw new NoteError(409, `A note called "${slug}" already exists in ${vault.label}. Pick a different title, or add to it with append_to_note (id "${vault.id}/${slug}").`);
  const meta = { name: slug, description: input.description, metadata: { type: input.type, modified: new Date().toISOString(), author } };
  fs.writeFileSync(p, joinNote(meta, input.body));
  updateIndex(vault.dir, file, { title: input.title, hook: input.description || input.title });
  return { vault: vault.id, file, id: `${vault.id}/${slug}` };
}
function locate(b) {
  const vault = vaultById(b.vault);
  if (!vault) throw new NoteError(404, 'That notebook no longer exists.');
  const p = notePath(vault, String(b.file));
  if (!fs.existsSync(p)) throw new NoteError(404, 'That note no longer exists. It may have been deleted.');
  return { vault, p };
}
function checkUnchanged(p, baseMtime) {
  if (baseMtime && Math.floor(fs.statSync(p).mtimeMs) !== Number(baseMtime)) {
    throw new NoteError(409, 'This note changed since it was opened (someone else updated it). Reload it, then make the change again.');
  }
}
// b: { vault, file, title, description, type, body, baseMtime }
function updateNote(b) {
  const { vault, p } = locate(b);
  checkUnchanged(p, b.baseMtime);
  const input = checkInput(b);
  const { meta } = splitNote(fs.readFileSync(p, 'utf8'));
  meta.description = input.description;
  if (meta.metadata && typeof meta.metadata === 'object') { meta.metadata.type = input.type; meta.metadata.modified = new Date().toISOString(); delete meta.type; }
  else { meta.type = input.type; }
  if (!meta.name) meta.name = stem(b.file);
  fs.writeFileSync(p, joinNote(meta, input.body));
  const writtenHere = !!(meta.metadata && meta.metadata.author);
  updateIndex(vault.dir, b.file, { title: input.title, hook: input.description || input.title, replaceHook: writtenHere });
  return { vault: vault.id, file: b.file, id: `${vault.id}/${stem(b.file)}` };
}
// Adds a dated line ("As of 2026-11-11: ...") to the end of a note; it shows in the note's History.
function appendToNote(b) {
  const { vault, p } = locate(b);
  checkUnchanged(p, b.baseMtime);
  const text = String(b.text || '').trim().replace(/\n\s*\n+/g, '\n');
  if (!text) throw new NoteError(400, 'Nothing to add: text is empty.');
  const { meta, body } = splitNote(fs.readFileSync(p, 'utf8'));
  if (meta.metadata && typeof meta.metadata === 'object') meta.metadata.modified = new Date().toISOString();
  fs.writeFileSync(p, joinNote(meta, `${body.trim()}\n\nAs of ${today()}: ${text}`));
  return { vault: vault.id, file: b.file, id: `${vault.id}/${stem(b.file)}` };
}
function deleteNote(b) {
  const { vault, p } = locate(b);
  fs.unlinkSync(p);
  updateIndex(vault.dir, b.file, null);
  return { ok: true };
}

module.exports = {
  PROJECTS, SHARED_DIR, SHARED_ID, NOTE_TYPES, NoteError,
  labelFor, discoverVaults, resolveProject, ensureShared,
  splitNote, joinNote, readAll, findById, getNote, searchNotes, listProjects,
  createNote, updateNote, appendToNote, deleteNote, noteId, titleOf,
};
