---
name: create-note
description: Save something to the user's notes hub. Use when the user says "note this", "save this", "write that down", "add to my notes", "remember this in my notes", or asks you to record a decision, result, setup or how-to for later.
allowed-tools: mcp__plugin_notes_notes__search_notes mcp__plugin_notes_notes__get_note mcp__plugin_notes_notes__create_note mcp__plugin_notes_notes__append_to_note mcp__plugin_notes_notes__list_projects mcp__notes__search_notes mcp__notes__get_note mcp__notes__create_note mcp__notes__append_to_note mcp__notes__list_projects
---

# Save to the notes hub

The notes hub is a local server shared by every project and agent. Use its MCP tools (server `notes`): `search_notes`, `get_note`, `create_note`, `append_to_note`, `list_projects`.

## Steps

1. **Search first.** Call `search_notes` with 2–4 key words from the topic. If a note already covers it, add to that note with `append_to_note` instead of creating a duplicate. The text becomes a dated History entry, so write one short, self-contained paragraph.
2. **Otherwise create** with `create_note`:
   - `title`: short and specific, like "Oilberry diesel line" rather than "Notes".
   - `summary`: one line saying what the note is for.
   - `body`: Markdown. Lead with the facts the user will want later (numbers, names, decisions, why). Link related notes with `[[note-name]]`, using the id part after the `/`.
   - `category`: `project` for plans and status, `reference` for facts and how-tos, `feedback` for how the user wants you to work, `user` for things about the user, `idea` for ideas (or use the ideas skill).
   - `project`: leave it out to save in the **Shared** notebook (the default). Pass a notebook name from `list_projects`, or the current working directory's full path, only when the user asks or the note clearly belongs to this project.
3. **Confirm briefly**: tell the user the note's title and that it's in the notes site (http://notes.localhost:6683).

Write what the user said in their words. Don't invent details, and don't save secrets (passwords, tokens, keys).

## If the tools aren't available

If there are no `notes` MCP tools, the server isn't connected. Check that it's running:

- Windows: run `start-notes.cmd` in the notes folder.
- macOS or Linux: run `sh start-notes.sh` in the notes folder.

The site is at http://notes.localhost:6683. Then ask the user to run `/mcp` to reconnect. Don't write the note files by hand.
