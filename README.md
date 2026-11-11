# Notes

A local notes hub for you and your AI agents. It has an Obsidian-style website for reading and writing notes, and an
MCP server so Claude Code, Claude Desktop and other agents can search, read and add to the same notes.

- **Website:** http://notes.localhost:6683 (Safari needs http://localhost:6683)
- **MCP endpoint:** http://localhost:6683/mcp

Works on Windows, macOS and Linux. Needs Node.js 18 or newer; no other dependencies. Everything stays on your computer.

## What you get

- **One place for every note.** A **Shared** notebook for anything, plus the notes Claude Code keeps for each project
  (`~/.claude/projects/*/memory`), found automatically.
- **Organised like a notes app.** Notebooks, then categories: Projects & plans, Reference, How Claude should work,
  About you, Ideas. It has `[[links]]` between notes, backlinks, a graph view and search.
- **History.** Lines that start with a date, like `As of 2026-11-11:`, show as a timeline, newest first.
- **Write and edit** in the browser. Changes from Claude or other agents show up live.
- **Agents use the same notes.** Claude can save a note when you say "note this", look things up when you ask "what
  do my notes say about…", and keep a list of your ideas.
- **Safe edits.** If a note changes while you, or an agent, are editing it, the save is refused so nothing is lost.
  Agents can't delete notes; only you can, in the website.

## Quick start

1. Clone the repo, then start the server:
   - Windows: double-click `start-notes.cmd`
   - macOS or Linux: `sh start-notes.sh`
2. Make it start at login: `install-autostart.cmd` (Windows) or `sh install-autostart.sh` (macOS, Linux).
3. Connect Claude Code (plugin with skills):
   ```
   /plugin marketplace add adamedmunds/claude-notes
   /plugin install notes@claude-notes
   ```

## Running the server

| | Open the site now | Start automatically at login | Stop starting at login |
|---|---|---|---|
| Windows | double-click `start-notes.cmd` | double-click `install-autostart.cmd` | `uninstall-autostart.cmd` |
| macOS | `sh start-notes.sh` | `sh install-autostart.sh` (launchd) | `sh uninstall-autostart.sh` |
| Linux | `sh start-notes.sh` | `sh install-autostart.sh` (systemd user service) | `sh uninstall-autostart.sh` |

You can also run it in a terminal with `npm start`. Server messages go to `notes-server.log` in this folder.

On macOS and Linux, run `install-autostart.sh` again after moving this folder or switching Node versions (for example
with nvm), because it records the full path to `node`.

## Connecting Claude and other agents

The server has to be running. All of these connect to the same notes.

### Claude Code: plugin (recommended)

```
/plugin marketplace add adamedmunds/claude-notes
/plugin install notes@claude-notes
```

This adds the MCP tools and three skills. Claude also uses the skills without being asked when your request fits:

| Skill | Use it for |
|---|---|
| `/notes:create-note` | "note this", "save this", "add to my notes". Searches first and adds to an existing note rather than duplicating it |
| `/notes:query-notes` | "what do my notes say about…", "did we decide…". Reads the matching notes and says which ones it used |
| `/notes:ideas` | "I have an idea…", "what ideas did I have about…" |

The repo is private, so Claude Code uses your git credentials to fetch it. If HTTPS asks for a password, run
`gh auth setup-git` first. You can also install from a local clone: `/plugin marketplace add /path/to/this/folder`.

### Claude Code: tools only

```
claude mcp add --transport http --scope user notes http://localhost:6683/mcp
```

Use either this or the plugin, not both, or every tool shows up twice.

### Claude Desktop

Claude Desktop starts local programs, so it uses the small bridge `mcp-stdio.js`. Open Settings → Developer → Edit
Config, add this with the full path to this folder, and restart Claude Desktop:

```json
{
  "mcpServers": {
    "notes": { "command": "node", "args": ["/full/path/to/notes/mcp-stdio.js"] }
  }
}
```

### Other agents

Any MCP client that supports the Streamable HTTP transport can connect to `http://localhost:6683/mcp`. Clients that
only run local programs can use `node mcp-stdio.js`, as above.

### MCP tools

| Tool | What it does |
|---|---|
| `search_notes` | Find notes by words (all must match), optionally in one notebook or category |
| `get_note` | Read a note in full, with what it links to and what links to it |
| `list_recent` | Most recently updated notes |
| `list_projects` | The notebooks and how many notes each has |
| `create_note` | New note, in Shared unless another notebook is named |
| `append_to_note` | Add a dated History entry to an existing note |
| `update_note` | Change a note's title, summary, category or text; anything left out stays the same |
| `search_ideas`, `capture_idea` | Search or add to the Ideas category |

Notebooks can be named by their name ("Shared", "My app"), their id, or the full path of a folder you've used Claude
Code in. Edits can include the `updated` value the agent last read, and are refused if the note has changed since.

## How notes are stored

Each note is a Markdown file with a short header, the same format Claude Code uses for its memory:

```markdown
---
name: diesel-line
description: How the diesel line is set up
metadata:
  type: project
  modified: 2026-11-11T16:20:00.000Z
  author: user
---
Tower on circuit 2. See [[power-plan]].

As of 2026-11-11: Added an EV hatch.
```

- `type` sets the category: `project`, `reference`, `feedback`, `user` or `idea`.
- `author` is `user` for notes written in the site, or the agent's name. Claude's own memory notes don't have one.
- Each notebook has a `MEMORY.md` with one line per note (`- [Title](file.md) — summary`). Claude Code reads that
  index, so notes you add to a project's notebook are seen by Claude in that project.
- Shared notes live in `~/.claude-notes/shared`. Claude doesn't load them automatically; it reaches them through the
  MCP tools.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `6683` | Port to listen on. 6683 spells NOTE on a phone keypad and stays clear of common dev-server ports. If you change it, also change `.mcp.json` and your agents' config. |
| `NOTES_HOME` | `~/.claude-notes/shared` | Where the Shared notebook is stored |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where Claude Code keeps its data |

### Notebook names

Projects are named after their folder, so `~/code/my-app` shows as "My app". To pick your own names, copy
`labels.example.json` to `labels.json` and edit it. Each `match` is a regular expression tested against the folder
name Claude gives the project: its path, with every character that isn't a letter or digit turned into `-`. End it
with `$` so the same file works on any OS. `labels.json` stays on your computer and isn't committed.

## Troubleshooting

- **The site doesn't load.** The server isn't running: start it as above, then check `notes-server.log`. If the log
  says port 6683 is in use, another program has it; set `PORT` to something else.
- **`notes.localhost` doesn't work.** Use http://localhost:6683. Safari, and some setups, don't resolve `*.localhost`.
- **Claude doesn't have the notes tools.** Make sure the server is running, then run `/mcp` in Claude Code to
  reconnect. `claude mcp list` should show `notes` as connected.
- **"This note changed since…"** Someone else, probably Claude, saved the note while it was open. Copy your text,
  reload the note, and make the change again.

## Website API

The website uses a small JSON API. Read-only calls also work from scripts on this computer:

- `GET /api/notes`: all notebooks and notes
- `GET /api/search?q=words&project=&category=&limit=`: search results
- `GET /api/note?id=shared/my-note`: one note, with links and backlinks
- `GET /api/events`: live change notifications (Server-Sent Events)

Writes (`POST`, `PUT`, `DELETE /api/notes`) are only for the website. Agents should use the MCP tools.

## Development

```
npm start   # run the server
npm test    # end-to-end tests against a temporary folder (never your real notes)
```

| File | What's in it |
|---|---|
| `notes.js` | Notebooks, reading, writing and searching notes. The website and MCP both use it |
| `mcp.js` | The MCP endpoint and tool definitions |
| `server.js` | Web server: the website, its API, live updates |
| `mcp-stdio.js` | Bridge for MCP clients that only start local programs |
| `public/` | The website |
| `skills/`, `.claude-plugin/`, `.mcp.json` | The Claude Code plugin |
| `test/run.js` | Tests |

See [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

## Security

The server only listens on this computer (127.0.0.1) and only answers requests addressed to its own names, which
blocks DNS-rebinding tricks. Other websites can't use it either: the API needs a header only this site sends, and
the MCP endpoint rejects browser requests from any other origin.

## Privacy

Everything stays on your computer. The server reads and writes note files in your home folder and doesn't send
anything anywhere.
