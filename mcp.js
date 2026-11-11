// MCP (Model Context Protocol) endpoint so Claude and other agents can use the notes.
// Streamable HTTP transport, answered with plain JSON (no streaming), no sessions, no dependencies.
// Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
const notes = require('./notes');

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'notes', title: 'Notes', version: '1.2.0' };
const INSTRUCTIONS = [
  "The user's personal notes hub, shared by every project and agent.",
  'Search before you create: if a note on the topic exists, add to it with append_to_note instead of making a duplicate.',
  'New notes go to the Shared notebook unless the user names a project.',
  'Categories: project (plans, status), reference (facts, how-tos), feedback (how the user wants agents to work), user (about the user), idea (ideas to explore).',
  'Link notes with [[note-name]]. Deleting notes is only possible in the website (http://notes.localhost:6683).',
].join(' ');

const CATEGORY = { type: 'string', enum: notes.NOTE_TYPES, description: 'project = plans and status, reference = facts and how-tos, feedback = how the user wants agents to work, user = about the user, idea = ideas to explore.' };
const PROJECT = { type: 'string', description: 'Notebook name or id from list_projects, or the full path of a folder you use Claude Code in. Leave out for the Shared notebook.' };
const ID = { type: 'string', description: 'Note id, like "shared/oilberry-diesel". Get ids from search_notes, list_recent or search_ideas.' };
const EXPECTED = { type: 'string', description: 'Optional: the "updated" value you last saw for this note. If the note changed since, the edit is refused so nobody\'s change is lost.' };

const TOOLS = [
  {
    name: 'search_notes',
    title: 'Search notes',
    description: "Search the user's notes across all projects. Every word must appear in the title, summary or text. Returns ids, titles, summaries and a snippet; use get_note for the full text.",
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for.' }, project: PROJECT, category: CATEGORY, limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Most results to return (default 10).' } }, required: ['query'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'search_ideas',
    title: 'Search ideas',
    description: "Search only the user's ideas. Leave query empty to list the newest ideas.",
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, project: PROJECT, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_note',
    title: 'Read a note',
    description: 'Read one note in full: text, category, project, last update, links to other notes and notes that link to it.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_recent',
    title: 'Recently updated notes',
    description: 'List the most recently updated notes, optionally for one project or category.',
    inputSchema: { type: 'object', properties: { project: PROJECT, category: CATEGORY, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_projects',
    title: 'List notebooks',
    description: 'List the notebooks: Shared plus one per Claude Code project that has notes, with note counts.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_note',
    title: 'Create a note',
    description: 'Create a new note. Search first; if a note on the topic already exists, use append_to_note instead. Saved in the Shared notebook unless project is given.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, specific title (becomes the file name).' },
        body: { type: 'string', description: 'The note in Markdown. Start a line with "As of YYYY-MM-DD:" to put it in the note\'s History.' },
        summary: { type: 'string', description: 'One line shown in lists and search results.' },
        category: { ...CATEGORY, description: CATEGORY.description + ' Default: reference.' },
        project: PROJECT,
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'capture_idea',
    title: 'Save an idea',
    description: 'Save an idea as a note in the Ideas category. Search ideas first and append if it builds on an existing one.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string', description: 'The idea and any context, in Markdown.' }, summary: { type: 'string' }, project: PROJECT }, required: ['title'] },
  },
  {
    name: 'append_to_note',
    title: 'Add to a note',
    description: 'Add a dated entry ("As of <today>: ...") to the end of an existing note. The safest way to add new information; it appears in the note\'s History.',
    inputSchema: { type: 'object', properties: { id: ID, text: { type: 'string', description: 'What to add (one short paragraph).' }, expected_updated: EXPECTED }, required: ['id', 'text'] },
  },
  {
    name: 'update_note',
    title: 'Edit a note',
    description: 'Change a note\'s title, summary, category or whole text. Fields you leave out stay the same. To add information, prefer append_to_note. Read the note with get_note first.',
    inputSchema: { type: 'object', properties: { id: ID, title: { type: 'string' }, summary: { type: 'string' }, category: CATEGORY, body: { type: 'string', description: 'Replaces the whole text.' }, expected_updated: EXPECTED }, required: ['id'] },
    annotations: { destructiveHint: true },
  },
];

// ---------- formatting results for agents ----------
const fmtList = (list, empty) => (!list.length ? empty : list.map((n, i) =>
  `${i + 1}. ${n.title} (id: ${n.id})\n   ${n.category} in ${n.project}, updated ${n.updated.slice(0, 10)}${n.summary ? `\n   ${n.summary}` : ''}${n.snippet ? `\n   ${n.snippet}` : ''}`).join('\n'));

function noteFile(id) {
  const n = notes.findById(notes.readAll().notes, id);
  return n;
}
function guardChanged(n, expected) {
  if (expected && expected !== n.modified) throw new notes.NoteError(409, `This note changed since you read it (now updated ${n.modified}). Read it again with get_note, then retry.`);
}

const HANDLERS = {
  search_notes: a => {
    const r = notes.searchNotes({ query: a.query, project: a.project, category: a.category, limit: a.limit });
    return fmtList(r, `No notes match "${a.query}". Try fewer or different words, or list_recent.`);
  },
  search_ideas: a => {
    const r = notes.searchNotes({ query: a.query || '', project: a.project, category: 'idea', limit: a.limit });
    return fmtList(r, a.query ? `No ideas match "${a.query}".` : 'No ideas saved yet.');
  },
  list_recent: a => fmtList(notes.searchNotes({ query: '', project: a.project, category: a.category, limit: a.limit || 10 }), 'No notes yet.'),
  list_projects: () => notes.listProjects().map(p => `- ${p.name} (id: ${p.id}): ${p.notes} notes${p.shared ? ' (default for new notes)' : ''}`).join('\n'),
  get_note: a => {
    const n = notes.getNote(a.id);
    const links = n.links.map(l => (l.id ? `${l.title} (${l.id})` : `${l.missing} (not written yet)`)).join(', ');
    return [
      `# ${n.title}`,
      `id: ${n.id}`,
      `category: ${n.category}, project: ${n.project}, updated: ${n.updated}${n.author ? `, written by: ${n.author}` : ''}`,
      n.summary ? `summary: ${n.summary}` : null,
      '',
      n.body || '(empty)',
      '',
      links ? `Links to: ${links}` : null,
      n.backlinks.length ? `Linked from: ${n.backlinks.map(b => `${b.title} (${b.id})`).join(', ')}` : null,
    ].filter(x => x !== null).join('\n');
  },
  create_note: (a, agent) => {
    const r = notes.createNote({ vault: a.project, title: a.title, body: a.body, description: a.summary, type: a.category }, agent);
    return `Created "${a.title}" (id: ${r.id}).`;
  },
  capture_idea: (a, agent) => {
    const r = notes.createNote({ vault: a.project, title: a.title, body: a.body || '', description: a.summary, type: 'idea' }, agent);
    return `Saved idea "${a.title}" (id: ${r.id}).`;
  },
  append_to_note: a => {
    const n = noteFile(a.id);
    guardChanged(n, a.expected_updated);
    notes.appendToNote({ vault: n.vault, file: n.file, text: a.text, baseMtime: n.mtimeMs });
    return `Added to "${notes.titleOf(n)}" (id: ${notes.noteId(n)}).`;
  },
  update_note: a => {
    const n = noteFile(a.id);
    guardChanged(n, a.expected_updated);
    notes.updateNote({
      vault: n.vault, file: n.file, baseMtime: n.mtimeMs,
      title: a.title ?? notes.titleOf(n), description: a.summary ?? n.description,
      type: a.category ?? (n.type === 'other' ? 'reference' : n.type), body: a.body ?? n.body,
    });
    return `Updated "${a.title ?? notes.titleOf(n)}" (id: ${notes.noteId(n)}).`;
  },
};

// ---------- JSON-RPC ----------
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function callOne(msg, agent) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg && msg.id, -32600, 'Invalid request.');
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null; // notifications/initialized, cancelled, etc.: nothing to answer
  const p = msg.params || {};
  const ok = result => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize':
      return ok({
        protocolVersion: PROTOCOLS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: TOOLS });
    case 'tools/call': {
      const handler = HANDLERS[p.name];
      if (!handler) return rpcError(msg.id, -32602, `Unknown tool "${p.name}".`);
      try {
        return ok({ content: [{ type: 'text', text: handler(p.arguments || {}, agent) }] });
      } catch (e) {
        if (!(e instanceof notes.NoteError)) console.error(e);
        return ok({ content: [{ type: 'text', text: e instanceof notes.NoteError ? e.message : 'The notes server hit an error. Check notes-server.log.' }], isError: true });
      }
    }
    default: return rpcError(msg.id, -32601, `Method "${msg.method}" isn't supported.`);
  }
}

// Who is writing: the stdio bridge passes the client's name; otherwise use the User-Agent.
function agentName(req) {
  const raw = req.headers['x-notes-agent'] || (String(req.headers['user-agent'] || '').match(/claude-code/i) ? 'claude-code' : String(req.headers['user-agent'] || '').split(/[\/\s]/)[0]);
  return String(raw || 'agent').replace(/[^\w .-]/g, '').slice(0, 40) || 'agent';
}

// req/res: Node http objects. allowedOrigins: origins of this site. readJson: body parser.
async function handleMcp(req, res, { allowedOrigins, readJson }) {
  const reply = (code, body, headers = {}) => {
    res.writeHead(code, { 'Cache-Control': 'no-store', ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...headers });
    res.end(body ? JSON.stringify(body) : undefined);
  };
  // The spec requires checking Origin so web pages can't reach a local server (DNS rebinding).
  if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return reply(403, rpcError(null, -32000, 'Forbidden origin.'));
  if (req.method !== 'POST') return reply(405, null, { Allow: 'POST' });
  if (!/application\/json/i.test(req.headers['content-type'] || '')) return reply(415, rpcError(null, -32700, 'Send JSON (Content-Type: application/json).'));
  let body;
  try { body = await readJson(req); } catch { return reply(400, rpcError(null, -32700, 'Parse error.')); }
  const agent = agentName(req);
  if (Array.isArray(body)) {
    const out = body.map(m => callOne(m, agent)).filter(Boolean);
    return out.length ? reply(200, out) : reply(202);
  }
  const out = callOne(body, agent);
  return out ? reply(200, out) : reply(202);
}

module.exports = { handleMcp, TOOLS };
