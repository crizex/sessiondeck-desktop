# Changelog

## 1.4.0

- Update notice: bigger and easier to spot, top right below the tabs, with a gold glow and the new version
  in large type. "Remind me tomorrow" hides it for 24 hours; a newer version shows up right away.
- Image paths in the terminal are clickable when they are relative (`[image] assets/logo.png`), resolved
  against the session folder, then `projectsRoot`.
- Long image paths that Claude Code wraps in its Read view are joined again and open as a whole.
- The empty screen no longer blocks clicks: after closing the last session, the × of an open recap or preview
  works again. Its hint now centers over the session area instead of running into the preview.

## 1.3.1

- Highlights work again: the active tab, the selected row in `Ctrl+K` and the `+` menu, the current search hit,
  active tool buttons and the settings gear. The styles used a different class name than the code.

## 1.3.0

- Queue: "To next free" hands a prompt to the first session that has been calm for a minute and has nothing
  queued of its own, optionally only sessions in the same folder. If none is free after two minutes, SessionDeck
  starts a new session there and the prompt goes out once Claude is ready (checkbox, on by default).
- Recap (`Ctrl+Shift+B`, button or `Ctrl+K`): duration, prompts, tool calls and tokens of a session, its commits
  (found by file, commit message or hash in the output), the files it changed with +/- and what is not committed
  yet, with "Ask to commit". The End dialog shows a short version, which can be turned off in Settings.
- Templates: lines like `api | run the tests` in Settings show up on top of the `+` menu and in `Ctrl+K`.
  A click starts a session in that folder and queues the prompt until Claude is ready.
- The `+` key in the empty screen no longer sits on its own grey line.

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
