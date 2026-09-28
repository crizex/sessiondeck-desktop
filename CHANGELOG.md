# Changelog

## 1.2.2

- Diff view: "Ask to commit" puts a commit prompt into the session's queue. It goes out as soon as the
  session is done. The text is a setting ("Commit prompt", default `commit and push`).
- README: the architecture diagram no longer cuts off its second lines on GitHub.

## 1.2.1

- Diff view (`Ctrl+Shift+D`) shows only the files this session edited, read from its Claude transcript.
  Sessions sharing a folder (or a monorepo) no longer see each other's changes. Files in other repos the
  session touched show up too, with their full path. Without a transcript it falls back to the whole folder.

## 1.2.0

- Prompt queue per session: line up the next prompts with `Ctrl+Shift+Q` or the queue button. The app sends
  them one at a time as soon as the session is done (never while it works or while a question is open).
  A small counter on the tab shows how many are waiting, × removes one. The queue survives a restart.

## 1.1.0

- Split view by drag and drop: drag a tab onto the right half of the terminal to open it side by side,
  onto the left half (or either side of a split) to show it there.
- Closing a split is now easy with the mouse: each side has a × button, or drag the tab back onto the tab bar.
  `Ctrl+click` and `Ctrl+#` still work.

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
