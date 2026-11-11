# Notes

A local notes hub for you and your AI agents. It has an Obsidian-style website for reading and writing notes, and an
MCP server so Claude Code, Claude Desktop and other agents can search, read and add to the same notes.

It shows a **Shared** notebook for anything, plus the notes Claude Code keeps for each project
(`~/.claude/projects/*/memory`). Works on Windows, macOS and Linux. Needs Node.js 18 or newer; no other dependencies.

- Website: **http://notes.localhost:6683** (or http://localhost:6683, which Safari needs)
- MCP endpoint: **http://localhost:6683/mcp**

## Start it

| | Open the site now | Start automatically at login | Stop starting at login |
|---|---|---|---|
| Windows | double-click `start-notes.cmd` | double-click `install-autostart.cmd` | `uninstall-autostart.cmd` |
| macOS | `sh start-notes.sh` | `sh install-autostart.sh` (launchd) | `sh uninstall-autostart.sh` |
| Linux | `sh start-notes.sh` | `sh install-autostart.sh` (systemd user service) | `sh uninstall-autostart.sh` |

Or run it in a terminal with `npm start`.

On macOS and Linux, run `install-autostart.sh` again after moving this folder or switching Node versions (for example with nvm), because it records the full path to `node`.

Server messages go to `notes-server.log` in this folder.

## What it does

- Finds every Claude project that has notes, and picks up new ones by itself.
- Groups notes by notebook, then by category: Projects & plans, Reference, How Claude should work, About you, Ideas.
- Notes link to each other with `[[note-name]]`, with backlinks and a graph view.
- Lines starting with a date, like `As of 2026-11-11:`, appear in a History timeline.
- You can create, edit and delete notes. Notes are saved in the same format Claude uses and listed in that notebook's `MEMORY.md`, so Claude reads them in that project.
- Refreshes by itself when a note changes. If a note changes while you're editing it, saving stops so neither version is lost.
- Each note shows who wrote it: you, or the agent that created it.

## Use it from Claude and other agents

The server must be running (see above). Agents can search, read, create and add to notes. Only you can delete notes, in the website.

### Claude Code (plugin, recommended)

The plugin adds the MCP tools plus three skills: `/notes:create-note`, `/notes:query-notes` and `/notes:ideas`.
Claude also uses them by itself when you say things like "note this", "what do my notes say about…" or "I have an idea…".

```
/plugin marketplace add adamedmunds/claude-notes
/plugin install notes@claude-notes
```

For a private copy of the repo, Claude Code uses your existing git credentials. If HTTPS asks for a password, run
`gh auth setup-git` first. You can also add a local clone: `/plugin marketplace add /path/to/this/folder`.

### Claude Code (tools only, no skills)

```
claude mcp add --transport http --scope user notes http://localhost:6683/mcp
```

Use either the plugin or this, not both, or the tools show up twice.

### Claude Desktop

Claude Desktop starts local programs, so it uses the small bridge `mcp-stdio.js`. Add this to
`claude_desktop_config.json` (Settings → Developer → Edit Config), using the full path to this folder, then restart
Claude Desktop:

```json
{
  "mcpServers": {
    "notes": { "command": "node", "args": ["/full/path/to/notes/mcp-stdio.js"] }
  }
}
```

### Other agents

Any MCP client that supports the Streamable HTTP transport can connect to `http://localhost:6683/mcp`. Clients that
only run local programs can use `node mcp-stdio.js` like Claude Desktop.

### Tools

| Tool | What it does |
|---|---|
| `search_notes` | Find notes by words, optionally in one notebook or category |
| `get_note` | Read a note in full, with its links and backlinks |
| `list_recent` | Most recently updated notes |
| `list_projects` | The notebooks and how many notes each has |
| `create_note` | New note (Shared notebook unless a notebook is named) |
| `append_to_note` | Add a dated History entry to a note |
| `update_note` | Change a note's title, summary, category or text |
| `search_ideas` / `capture_idea` | The same, for the Ideas category |

Notes made by agents record which agent wrote them. Edits can pass the `updated` value they last saw, and are refused
if the note changed in between.

## Settings

- `PORT` (default `6683`): the port to listen on. 6683 spells NOTE on a phone keypad and stays clear of common
  dev-server ports. If you change it, change it in `.mcp.json` and in your agents' config too.
- `NOTES_HOME` (default `~/.claude-notes/shared`): where the Shared notebook is stored.
- `CLAUDE_CONFIG_DIR`: set this if your Claude Code data isn't in `~/.claude`.

### Notebook names

Projects are named after their folder, so `~/code/my-app` shows as "My app". To pick your own names, copy
`labels.example.json` to `labels.json` and edit it. Each `match` is a regular expression tested against the
folder name Claude gives the project (its path with every non-letter/digit turned into `-`). End it with `$`
so the same file works on any OS. `labels.json` stays on your computer and isn't committed.

## Security

The server only listens on this computer (127.0.0.1). It only answers requests addressed to its own names, which
blocks DNS-rebinding tricks. Other websites can't use it either: the API needs a header only this site sends, and the
MCP endpoint rejects browser requests from any other origin.

## Privacy

Everything stays on your computer. The server reads and writes note files in your home folder and doesn't send
anything anywhere. The MCP endpoint is only reachable from this computer.
