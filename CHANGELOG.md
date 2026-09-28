# Changelog

## 1.0.2

- Broadcast: session names are visible again next to their checkboxes.

## 1.0.1

- README: short demo animation of a multi-select question answered from the question card.

## 1.0.0

First public release.

- One tab per tmux session on your server, over a single SSH connection (private key or ssh-agent,
  host key pinned on first connect), with a full terminal in each tab.
- Session state at a glance: working, waiting for you, idle, plus a context bar from the status line.
  The tab that needs you glows.
- Question cards: answer Claude's choices, permission prompts and multi-select questions with a click
  or a number key, from any tab. Several open questions queue up.
- Desktop notifications when a session you are not looking at finishes or asks something.
- Search across all Claude transcripts of the last 30 days, with jump into the running session
  or resume in a new tab. Full history search within a session.
- Timeline of every round in a session: prompt, answer, tool count and file edits as diffs.
- Live preview of the page a session is building, desktop and phone side by side, reloading on file changes.
- Preview panel for files, images, diffs and claude.ai artifact links from the terminal.
- Split view, tab colors and names, broadcast of one message to several sessions, command palette.
- Optional voice input, recognized on your own server with faster-whisper (off by default).
- Windows installer with self-update from GitHub Releases, SHA-512 checked.
