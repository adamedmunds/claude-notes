#!/usr/bin/env node
// Bridge for MCP clients that can only start local programs (like Claude Desktop):
// reads JSON-RPC messages on stdin, forwards each to the running notes server, writes replies to stdout.
// Config example (claude_desktop_config.json):
//   "mcpServers": { "notes": { "command": "node", "args": ["/full/path/to/mcp-stdio.js"] } }
const http = require('http');
const readline = require('readline');

const PORT = Number(process.env.NOTES_PORT || process.env.PORT) || 6683;
let clientName = 'stdio-client';

function forward(line) {
  return new Promise(resolve => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST',
      headers: { Host: `localhost:${PORT}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'X-Notes-Agent': clientName },
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve(res.statusCode === 202 ? null : data));
    });
    req.on('error', () => resolve(undefined));
    req.end(line);
  });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const first = Array.isArray(msg) ? msg[0] : msg;
  if (first && first.method === 'initialize' && first.params && first.params.clientInfo) {
    clientName = String(first.params.clientInfo.name || clientName).replace(/[^\w .-]/g, '').slice(0, 40);
  }
  const reply = await forward(line);
  if (reply === null) return; // notification: nothing to send back
  if (reply === undefined) {
    // Server not running: answer requests with a clear error instead of hanging.
    const ids = (Array.isArray(msg) ? msg : [msg]).filter(m => m && m.id !== undefined && m.id !== null);
    for (const m of ids) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: `The notes server isn't running on port ${PORT}. Start it with start-notes.cmd (Windows) or start-notes.sh (macOS, Linux).` } }) + '\n');
    }
    return;
  }
  process.stdout.write(reply.replace(/\n/g, ' ') + '\n');
});
