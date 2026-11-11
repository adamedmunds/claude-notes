// Notes — a local website and MCP server for your notes and every Claude project's memory notes.
// Works on Windows, macOS and Linux (Node 18+). No dependencies.
// Run: node server.js  (or npm start), then open http://notes.localhost:6683
//   Website:  http://notes.localhost:6683
//   MCP:      http://localhost:6683/mcp   (for Claude Code, Claude Desktop via mcp-stdio.js, other agents)
const http = require('http');
const fs = require('fs');
const path = require('path');
const notes = require('./notes');
const { handleMcp } = require('./mcp');

// 6683 spells NOTE on a phone keypad. Chosen to stay clear of common dev ports
// (80, 3000, 5173+, 8080) and of Windows' reserved/dynamic port ranges.
const PORT = Number(process.env.PORT) || 6683;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
// Browsers send any *.localhost name to this PC, so http://notes.localhost:6683 needs no hosts-file edit.
const HOSTS = [`notes.localhost:${PORT}`, `localhost:${PORT}`, `127.0.0.1:${PORT}`];
const ALLOWED_HOSTS = new Set(HOSTS);
const ALLOWED_ORIGINS = new Set(HOSTS.map(h => `http://${h}`));

// ---------- live updates for the website (Server-Sent Events) ---------------
const clients = new Set();
let pending = null;
function broadcast() {
  clearTimeout(pending);
  pending = setTimeout(() => { for (const res of clients) res.write('event: change\ndata: notes\n\n'); }, 200);
}
// Watch each notebook folder directly (plain fs.watch works the same on
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
  for (const v of notes.discoverVaults()) watchDir(v.dir);
  if (watchers.size !== before) broadcast(); // a notebook appeared
}
function startWatching() {
  scanForProjects();
  setInterval(scanForProjects, 5000).unref();
  try { fs.watch(notes.PROJECTS, () => setTimeout(scanForProjects, 500)); } catch { /* the interval still covers it */ }
}

// ---------- http -------------------------------------------------------------
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
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
    if (url.pathname === '/mcp' || url.pathname.startsWith('/api/')) {
      // Only this site and local tools may call these: blocks other websites and DNS-rebinding tricks.
      if (!ALLOWED_HOSTS.has(req.headers.host)) throw new HttpError(403, 'Forbidden host.');
    }
    if (url.pathname === '/mcp') return await handleMcp(req, res, { allowedOrigins: ALLOWED_ORIGINS, readJson });
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.headers['x-notes-client'] !== '1') throw new HttpError(403, 'Forbidden.');
      if (url.pathname === '/api/notes' && req.method === 'GET') return send(res, 200, notes.readAll());
      if (url.pathname === '/api/search' && req.method === 'GET') {
        const q = url.searchParams;
        return send(res, 200, notes.searchNotes({ query: q.get('q') || '', project: q.get('project') || undefined, category: q.get('category') || undefined, limit: q.get('limit') || undefined }));
      }
      if (url.pathname === '/api/note' && req.method === 'GET') return send(res, 200, notes.getNote(url.searchParams.get('id')));
      if (url.pathname === '/api/notes' && req.method === 'POST') return send(res, 200, notes.createNote(await readJson(req), 'user'));
      if (url.pathname === '/api/notes' && req.method === 'PUT') return send(res, 200, notes.updateNote(await readJson(req)));
      if (url.pathname === '/api/notes' && req.method === 'DELETE') return send(res, 200, notes.deleteNote(await readJson(req)));
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
    const known = e instanceof HttpError || e instanceof notes.NoteError;
    if (!known) console.error(e);
    if (!res.headersSent) send(res, e.code || 500, { error: known ? e.message : 'Something went wrong on the notes server. Check notes-server.log for details.' });
  }
}

if (require.main === module) {
  http.createServer(handle).on('error', e => {
    if (e.code === 'EADDRINUSE') { console.log(`Port ${PORT} is already in use; Notes is probably already running at http://notes.localhost:${PORT}`); process.exit(0); }
    throw e;
  }).listen(PORT, '127.0.0.1', () => {
    notes.ensureShared();
    startWatching();
    console.log(`Notes running at http://notes.localhost:${PORT} (started ${new Date().toLocaleString('en-GB')})`);
    console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
    console.log(`Reading notes from ${notes.PROJECTS} and ${notes.SHARED_DIR}`);
  });
}

module.exports = { handle, labelFor: notes.labelFor, splitNote: notes.splitNote, joinNote: notes.joinNote };
