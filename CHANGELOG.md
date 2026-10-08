# Changelog

## 1.7.4

- Long questions from AskUserQuestion now arrive in full. The terminal wraps a long question over several lines,
  and only the last line ended up in the question card (for example just "are online?").

## 1.7.3

- New session menu (`+`) and command palette (`Ctrl+K`): every project folder is listed now. Before, the menu stopped
  after 40 folders and the palette after 12 entries, so later projects were only reachable by typing their name.
- Both lists scroll, and the search field stays at the top while you scroll.

## 1.7.2

- Terminal: paths with umlauts or other non-ASCII letters (for example `Projekte-Müller/notes.md`) are now
  clickable as a whole. Before, the link started only after the first such letter and pointed nowhere.

## 1.7.1

- Terminal: emoji now take two columns, the same width Claude Code assumes. Before, the status line could show
  stray characters or shifted text after a redraw when it contained emoji.

## 1.7.0

**Messages between sessions**
- New button with a speech bubble (and in `Ctrl+K`): shows what the current session exchanged with other sessions
  through `SendMessage`. Incoming with the sender's name, outgoing in gold, newest on top. Read from the transcript,
  nothing to install.

**5-hour limit**
- Your Claude.ai usage at the top right: percent and a thin bar, warm from 70 %, hot from 90 %. A click shows the
  reset time, the weekly share and which sessions are paused.
- The numbers come from Claude Code's status line: `server/statusline.sh` now also writes them to
  `~/.claude/sessiondeck-usage.json`. No extra API calls, no tokens. Copy the updated script to the server.

**Limit pause**
- New setting "Limit pause" (off by default): at the percent you set, every working session stops
  (Escape, background agents included). Once the limit has reset, each one gets a note to continue where it was.
  Only once per limit window, so whatever you start afterwards may use the rest.
- In the limit menu: "Pause all working sessions now" (asks once more) and "Send paused sessions on".
- The prompt queue sends nothing to a paused session.
- Same state file as sessiondeck 1.2.0 on the server, so both show the same paused sessions.

## 1.6.0

- Live preview: a click on the size below the phone cycles through phone (390 × 844), foldable closed
  (466 × 678) and foldable open (890 × 626). Open, a line marks the crease, where nothing important belongs.
  The choice is remembered.
- Live preview shows HTML drafts: without a saved address, if the session last wrote an `.html` file, the app
  serves its folder with `python3 -m http.server` (only on `127.0.0.1` of the server, one per folder) and opens
  the file. It reloads as soon as the draft changes. Otherwise it asks for the address as before.

## 1.5.1

- The tab bar no longer stays empty when the SSH session on the server has no UTF-8 locale. tmux then
  printed the separator between name, start time and folder as `_`, so no session was recognized.

## 1.5.0

- macOS app: ready-made downloads for Apple silicon and Intel on the releases page, signed ad hoc
  (first start via "Open Anyway", see the README). `npm run build-mac` builds them yourself, also on Linux.
- On the Mac, shortcuts use `⌘` instead of `Ctrl`; the palette, tooltips and hints show `⌘ ⇧ ⌥`.
  `Ctrl+Tab` stays, `⌘Tab` belongs to macOS.
- Traffic lights sit left of the tabs, waiting sessions show as a badge on the Dock icon, a click on the
  Dock icon brings the window back and `sessiondeck://` links also work on a cold start.
- The self-updater works on the Mac too: it downloads the archive for your chip, checks the SHA-512 and
  swaps the `.app` after quitting.

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
