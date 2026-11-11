---
name: ideas
description: Capture or recall the user's ideas in the notes hub. Use when the user says "I have an idea", "idea:", "add this to my ideas", "what ideas did I have about…", "show my ideas", or floats something they might want to try later.
allowed-tools: mcp__plugin_notes_notes__search_ideas mcp__plugin_notes_notes__capture_idea mcp__plugin_notes_notes__append_to_note mcp__plugin_notes_notes__get_note mcp__notes__search_ideas mcp__notes__capture_idea mcp__notes__append_to_note mcp__notes__get_note
---

# Ideas

Ideas live in the notes hub in their own **Ideas** category. Use the MCP tools (server `notes`): `search_ideas`, `capture_idea`, `append_to_note`, `get_note`.

## Saving an idea

1. Call `search_ideas` with the idea's key words. If an existing idea is the same or builds on it, add to it with `append_to_note` (one short paragraph), and tell the user which idea you added to.
2. Otherwise call `capture_idea`:
   - `title`: the idea in a few words.
   - `body`: the idea in the user's words, then any context that came up (why, constraints, first step), and `[[links]]` to related notes.
   - `summary`: optional one-liner.
   - Leave `project` out (it saves to Shared) unless the user ties the idea to a project.
3. Confirm in one line. Don't start working on the idea unless the user asks.

## Recalling ideas

- "What ideas do I have?": call `search_ideas` with no query to list the newest.
- "Ideas about X": call `search_ideas` with X, then `get_note` for the ones worth reading in full.
- Summarise briefly, newest first, with titles so the user can ask for one.

## If the tools aren't available

Start the notes server (`start-notes.cmd` on Windows, `sh start-notes.sh` on macOS or Linux), then run `/mcp` to reconnect.
