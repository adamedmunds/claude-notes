---
name: query-notes
description: Look things up in the user's notes hub. Use when the user asks "what do my notes say about…", "did we decide…", "look up…", "check my notes", or refers to earlier work, setups, numbers or decisions you don't have in context — including notes from other projects.
allowed-tools: mcp__plugin_notes_notes__search_notes mcp__plugin_notes_notes__get_note mcp__plugin_notes_notes__list_recent mcp__plugin_notes_notes__list_projects mcp__notes__search_notes mcp__notes__get_note mcp__notes__list_recent mcp__notes__list_projects
---

# Look up the notes hub

The notes hub holds the user's notes from every project plus a Shared notebook. Use its MCP tools (server `notes`): `search_notes`, `get_note`, `list_recent`, `list_projects`.

## Steps

1. Call `search_notes` with a few distinctive words (every word must match). If nothing comes back, try fewer or different words, a related term, or `list_recent` for what changed lately. Narrow with `project` or `category` when the user names one.
2. Open the most relevant one to three results with `get_note`. Search results only show a snippet. Follow `Links to` and `Linked from` when they look relevant.
3. Answer from the notes and say which notes you used, by title. If notes disagree, prefer the newest dated History entry ("As of …") and mention the conflict.
4. If the notes don't have the answer, say so plainly. Don't fill gaps with guesses.

Notes reflect what was true when they were written. If a note names a file, command or setting, check it still exists before relying on it.

## If the tools aren't available

If there are no `notes` MCP tools, the server isn't connected. Tell the user to start it:

- Windows: `start-notes.cmd`
- macOS or Linux: `sh start-notes.sh`

Then run `/mcp` to reconnect. For a quick read-only check without MCP, run `curl "http://localhost:6683/api/search?q=<words>"`. It returns JSON with ids, titles and snippets.
