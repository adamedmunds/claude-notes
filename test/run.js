// End-to-end tests: starts the server on a random port against a temporary folder
// (never your real notes) and exercises the website API and the MCP endpoint.
// Run: npm test
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// Everything below must be set before the server modules are loaded.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-test-'));
const PORT = 20000 + Math.floor(Math.random() * 20000);
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
process.env.NOTES_HOME = path.join(tmp, 'shared');
process.env.PORT = String(PORT);

// A Claude project with one note written by Claude's own memory (older top-level "type" format).
const SLUG = os.homedir().replace(/[^A-Za-z0-9]/g, '-') + '-code-my-app';
const MEM = path.join(tmp, 'claude', 'projects', SLUG, 'memory');
fs.mkdirSync(MEM, { recursive: true });
fs.writeFileSync(path.join(MEM, 'build-rules.md'), '---\nname: build-rules\ndescription: How to build\ntype: feedback\n---\nAlways run the build before a PR.\n');
fs.writeFileSync(path.join(MEM, 'MEMORY.md'), '- [Build rules](build-rules.md) — run the build first\n');

const notes = require('../notes');
const { handle } = require('../server');
const SHARED = process.env.NOTES_HOME;

let failures = 0;
function check(label, cond, detail) {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${!cond && detail ? `\n      ${detail}` : ''}`);
  if (!cond) failures++;
}
function request(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: PORT, path: url, method, headers: { Host: `localhost:${PORT}`, ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers } }, res => {
      let out = '';
      res.on('data', c => (out += c));
      res.on('end', () => { let json = null; try { json = out ? JSON.parse(out) : null; } catch { /* not JSON */ } resolve({ status: res.statusCode, body: json }); });
    });
    req.on('error', reject);
    req.end(data);
  });
}
let rpcId = 0;
const rpc = (method, params, headers) => request('POST', '/mcp', { jsonrpc: '2.0', id: ++rpcId, method, params }, headers);
async function tool(name, args) {
  const r = await rpc('tools/call', { name, arguments: args }, { 'User-Agent': 'claude-code/test' });
  if (!r.body.result) return { text: JSON.stringify(r.body.error), isError: true };
  return { text: r.body.result.content[0].text, isError: !!r.body.result.isError };
}
const read = f => fs.readFileSync(f, 'utf8');

async function main() {
  // --- names ---
  check('folder names become readable notebook names', notes.labelFor('-home-me-code-my-app', '-home-me', []) === 'My app');
  check('labels.json-style overrides win', notes.labelFor('-home-me-x', '-home-me', [[/-x$/, 'Custom']]) === 'Custom');

  // --- website API ---
  let r = await request('GET', '/api/notes');
  const vaultIds = r.body.vaults.map(v => v.id);
  check('GET /api/notes lists Shared first and the project', vaultIds[0] === 'shared' && vaultIds.includes(SLUG));
  check('Claude-written note is read with its category and title', r.body.notes.some(n => n.file === 'build-rules.md' && n.type === 'feedback' && n.title === 'Build rules'));
  r = await request('POST', '/api/notes', { vault: 'shared', title: 'Site note', body: 'x' });
  check('API writes without the site header are refused', r.status === 403);
  r = await request('POST', '/api/notes', { vault: 'shared', title: 'Site note', body: 'hello' }, { 'X-Notes-Client': '1' });
  check('site can create a note', r.status === 200 && /author: user/.test(read(path.join(SHARED, 'site-note.md'))));
  r = await request('GET', '/api/notes', undefined, { Host: 'evil.example' });
  check('foreign Host header is refused', r.status === 403);
  r = await request('GET', '/api/search?q=build');
  check('GET /api/search finds notes', Array.isArray(r.body) && r.body[0].title === 'Build rules');

  // --- MCP protocol ---
  r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  check('initialize', r.body.result.protocolVersion === '2025-06-18' && r.body.result.capabilities.tools && r.body.result.serverInfo.version === require('../package.json').version);
  r = await rpc('initialize', { protocolVersion: '1999-01-01' });
  check('unknown protocol version gets the latest', r.body.result.protocolVersion === '2025-06-18');
  r = await request('POST', '/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' });
  check('notifications get 202 and no body', r.status === 202 && r.body === null);
  r = await rpc('tools/list');
  const names = r.body.result.tools.map(t => t.name);
  check('nine tools, none that delete', names.length === 9 && !names.some(n => /delete/.test(n)), names.join(', '));
  r = await request('GET', '/mcp');
  check('GET /mcp is 405', r.status === 405);
  r = await request('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'http://evil.example' });
  check('foreign Origin is refused', r.status === 403);
  r = await request('POST', '/mcp', '{"jsonrpc":"2.0","id":1,"method":"ping"}', { 'Content-Type': 'text/plain' });
  check('non-JSON content type is refused', r.status === 415);
  r = await request('POST', '/mcp', '{oops');
  check('bad JSON is a parse error', r.status === 400);
  r = await request('POST', '/mcp', [{ jsonrpc: '2.0', id: 7, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }]);
  check('batches answer requests only', Array.isArray(r.body) && r.body.length === 1 && r.body[0].id === 7);
  r = await rpc('nope');
  check('unknown method error', r.body.error.code === -32601);

  // --- MCP tools ---
  let t = await tool('create_note', { title: 'Diesel line', body: 'Runs on circuit 2. See [[build-rules]].', summary: 'Diesel setup', category: 'project' });
  check('create_note saves to Shared by default', /id: shared\/diesel-line/.test(t.text), t.text);
  const diesel = path.join(SHARED, 'diesel-line.md');
  check('agent notes record the agent', /author: claude-code/.test(read(diesel)));
  check('MEMORY.md gets an index line', /\[Diesel line\]\(diesel-line\.md\) — Diesel setup/.test(read(path.join(SHARED, 'MEMORY.md'))));
  t = await tool('create_note', { title: 'Diesel line', body: 'again' });
  check('duplicates are refused with a hint to append', t.isError && /append_to_note/.test(t.text));
  t = await tool('create_note', { title: 'x', body: 'y', category: 'nonsense' });
  check('unknown category is refused', t.isError && /Unknown category/.test(t.text));
  t = await tool('create_note', { title: 'x', body: 'y', project: 'Nope' });
  check('unknown notebook is refused with the list', t.isError && /Shared/.test(t.text));
  t = await tool('create_note', { title: 'App idea list', body: 'z', project: 'My app' });
  check('create_note into a project by name', new RegExp(`id: ${SLUG}/app-idea-list`).test(t.text), t.text);

  t = await tool('capture_idea', { title: 'Automate tanks', body: 'Use level emitters.' });
  check('capture_idea', /Saved idea/.test(t.text) && /type: idea/.test(read(path.join(SHARED, 'automate-tanks.md'))));
  t = await tool('search_ideas', {});
  check('search_ideas lists only ideas', /Automate tanks/.test(t.text) && !/Diesel line/.test(t.text));
  t = await tool('search_notes', { query: 'diesel circuit' });
  check('search_notes needs every word', /Diesel line/.test(t.text) && !/Build rules/.test(t.text));
  t = await tool('search_notes', { query: 'zzzz' });
  check('search with no matches says so', /No notes match/.test(t.text));

  t = await tool('get_note', { id: 'shared/diesel-line' });
  check('get_note shows links across notebooks', /Links to: Build rules/.test(t.text), t.text);
  const updated = t.text.match(/updated: (\S+?),/)[1];
  t = await tool('get_note', { id: `${SLUG}/build-rules` });
  check('get_note shows backlinks', /Linked from: Diesel line/.test(t.text));

  t = await tool('append_to_note', { id: 'shared/diesel-line', text: 'Added an EV hatch.\n\nNow 273 L/s.' });
  check('append_to_note adds one dated History entry', /\n\nAs of \d{4}-\d{2}-\d{2}: Added an EV hatch\.\nNow 273 L\/s\.\n$/.test(read(diesel)), JSON.stringify(read(diesel).slice(-80)));
  t = await tool('update_note', { id: 'shared/diesel-line', summary: 'stale', expected_updated: updated });
  check('edits based on an old read are refused', t.isError && /changed since you read it/.test(t.text));
  t = await tool('update_note', { id: 'shared/diesel-line', summary: 'Diesel setup and history' });
  check('update_note changes only the given fields', /Diesel setup and history/.test(read(diesel)) && /Added an EV hatch/.test(read(diesel)) && /type: project/.test(read(diesel)));
  t = await tool('update_note', { id: `${SLUG}/build-rules`, summary: 'new' });
  check("Claude's own index hook is kept when an agent edits its note", /— run the build first/.test(read(path.join(MEM, 'MEMORY.md'))) && /^type: feedback/m.test(read(path.join(MEM, 'build-rules.md'))));
  t = await tool('get_note', { id: 'bad' });
  check('bad ids explain the format', t.isError && /isn't a note id/.test(t.text));
  t = await tool('list_projects', {});
  check('list_projects', /Shared \(id: shared\)/.test(t.text) && /My app/.test(t.text));
  t = await tool('list_recent', { limit: 2 });
  check('list_recent honours the limit', (t.text.match(/^\d+\./gm) || []).length === 2);
}

const server = http.createServer(handle).listen(PORT, '127.0.0.1', async () => {
  try { await main(); } catch (e) { console.error(e); failures++; }
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures ? `\n${failures} failed` : '\nAll tests passed');
  process.exit(failures ? 1 : 0);
});
