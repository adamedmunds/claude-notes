# Changelog

## 1.2.0

- **MCP server** at `http://localhost:6683/mcp` so Claude and other agents can search, read, create and add to notes.
  Tools: `search_notes`, `get_note`, `list_recent`, `list_projects`, `create_note`, `append_to_note`, `update_note`,
  `search_ideas`, `capture_idea`. Agents can't delete notes.
- **Claude Code plugin**: the repo is its own plugin marketplace. It bundles the MCP server and three skills:
  `create-note`, `query-notes` and `ideas`.
- **Claude Desktop bridge** (`mcp-stdio.js`) for clients that only launch local programs.
- **Shared notebook** (`~/.claude-notes/shared`): the default home for new notes, not tied to any Claude project.
- **Ideas** category.
- Notes record who wrote them (you, or the agent's name), shown in the site.
- `npm test` runs end-to-end tests against a temporary folder.
- Code split into `notes.js` (storage and search), `mcp.js` (MCP) and `server.js` (website).

## 1.1.0

- Runs on macOS and Linux as well as Windows, with start and autostart scripts for each (launchd, systemd).
- Address is `http://notes.localhost:6683`.
- Your own notebook names go in a local `labels.json`, which isn't committed.

## 1.0.0

- Obsidian-style website for Claude Code's memory notes in every project: categories, `[[links]]`, backlinks, graph,
  search and a History timeline for dated lines.
- Create, edit and delete notes, with a check that stops you overwriting a note that changed while you edited it.
- Updates live when notes change; starts at login on Windows.
