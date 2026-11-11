# Notes

A local, Obsidian-style site for reading and writing the notes Claude Code keeps for each project
(`~/.claude/projects/*/memory`). Works on Windows, macOS and Linux. Needs Node.js 18 or newer; no other dependencies.

Open it at **http://notes.localhost:6683** (or http://localhost:6683, which Safari needs).

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
- Groups notes by project, then by category. Notes link to each other with `[[note-name]]`.
- Lines starting with a date, like `As of 2026-11-11:`, appear in a History timeline.
- You can create, edit and delete notes. Your notes are saved in the same format Claude uses and listed in that project's `MEMORY.md`, so Claude reads them in that project.
- Refreshes by itself when Claude changes a note. If a note changes while you're editing it, saving stops so neither version is lost.

## Settings

- `PORT` (default `6683`): the port to listen on. 6683 spells NOTE on a phone keypad and stays clear of common dev-server ports.
- `CLAUDE_CONFIG_DIR`: set this if your Claude Code data isn't in `~/.claude`.

### Project names

Projects are named after their folder, so `~/code/my-app` shows as "My app". To pick your own names, copy
`labels.example.json` to `labels.json` and edit it. Each `match` is a regular expression tested against the
folder name Claude gives the project (its path with every non-letter/digit turned into `-`). End it with `$`
so the same file works on any OS. `labels.json` stays on your computer and isn't committed.

Only pages served from this site can use its API, and it only listens on this computer (127.0.0.1).
