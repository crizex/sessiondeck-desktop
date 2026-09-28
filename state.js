// Pure logic without Electron: reading Claude's screen, session state, colors, tab order,
// notifications, the question card, versions. Also loaded in the renderer via <script>.

const PALETTE = ['#FF6B4A', '#4ADE9A', '#6AB8FF', '#FFD76A', '#FF8FB1', '#C6F06A'];

function color(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Tab title: a hand-picked tmux name, otherwise the project folder (names like "sd-k3x9" or "0" say nothing).
function title(s) {
  if (s.name && !/^(sd-[a-z0-9]+|\d+)$/.test(s.name)) return s.name;
  return String(s.cwd || '').split('/').filter(Boolean).pop() || s.name || s.id;
}

// ── Reading Claude Code's screen (tmux capture-pane) ────────────────

// While working Claude Code shows a line like "✽ Ionizing\u2026 (1m 24s · ↓ 6.7k tokens)".
const WORKING_RE = /\u2026\s*\((?:\d+h\s*)?(?:\d+m\s*)?\d+s\b/;
// Done, but subagents or background shells are still running: needs no attention, counts as working.
// ponytail: a dev server running as background shell keeps the session "working" too.
const BACKGROUND_RE = /Waiting for \d+ background|\d+s · [↓↑] [\d.]+k? tokens|\d+ shells? still running|· \d+ shells? ·/;
// Selection menu (AskUserQuestion, permission prompt, trust dialog): Claude waits for a decision.
const ASKING_RE = /Enter to select|Enter to confirm|Do you want to|Would you like to|❯\s*1\./;
const OPTION_RE = /^\s*(?:❯\s*)?(\d+)\.\s+(.+)$/;

// Menu from the bottom: last "1." and all following numbers in sequence. Question = the line before.
function readQuestion(lines) {
  const start = lines.findLastIndex(l => OPTION_RE.exec(l)?.[1] === '1');
  if (start < 0) return null;
  const options = [];
  for (const l of lines.slice(start)) {
    const m = OPTION_RE.exec(l);
    if (m && +m[1] === options.length + 1) {
      const text = m[2].trim();
      options.push({ n: +m[1], text, free: /^Type something\.?$/.test(text) });
    }
  }
  const text = lines.slice(0, start).findLast(l => l.trim() && !/^\s*☐/.test(l) && !/^─{10,}/.test(l));
  return { text: (text || '').trim(), options };
}

function readPane(text) {
  const z = text.replace(/\s+$/, '').split('\n').map(l => l.replace(/\s+$/, ''));
  // The prompt box sits between the last two ─ rules, the status lines below it.
  const rules = z.map((l, i) => (/^─{10,}/.test(l) ? i : -1)).filter(i => i >= 0);
  const end = rules.length >= 2 ? rules[rules.length - 2] : z.length;
  const body = z.slice(0, end).filter(l => l.trim() && !/^\s*⎿\s+Tip:/.test(l));
  const bottom = z.slice(-25);
  const asking = ASKING_RE.test(bottom.join('\n'));
  const status = rules.length >= 2 ? z.slice(end).join('\n') : '';
  // Status line below the prompt, e.g. "14% ctx (139k/1000k)" (see server/statusline.sh)
  const ctx = /(\d+)% ctx\b/.exec(status);
  const tokens = /\bctx \((\d+)k\/(\d+)k\)/.exec(status);
  const artifacts = text.match(/https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/g);
  return {
    working: body.slice(-4).some(l => WORKING_RE.test(l) || BACKGROUND_RE.test(l)) || BACKGROUND_RE.test(status),
    asking,
    question: asking ? readQuestion(bottom) : null,
    contextPct: ctx ? Number(ctx[1]) : null,
    tokensK: tokens ? Number(tokens[1]) : null,
    windowK: tokens ? Number(tokens[2]) : null,
    artifact: artifacts ? artifacts[artifacts.length - 1] : null,
  };
}

// After finishing, a session counts as "waiting for you" this long, then it is idle.
// ponytail: a time window instead of a real "seen" mark, tmux does not know about one.
const WAITING_MS = 30 * 60 * 1000;

// One poll: raw tmux sessions ({ name, cwd, created, screen }) plus the previous glances
// -> sessions for the UI and the new glances. A screen that changed means activity.
function snapshot(raw, prev, now) {
  const glances = {}, sessions = [];
  for (const r of [...raw].sort((a, b) => a.created - b.created)) {
    const old = prev[r.name];
    const g = { ...readPane(r.screen), screen: r.screen, changedAt: old && old.screen === r.screen ? old.changedAt : now };
    // The artifact link stays remembered after it scrolled out of view.
    g.artifact ??= old?.artifact ?? null;
    glances[r.name] = g;
    sessions.push({
      id: r.name, name: r.name, tmux: r.name, cwd: r.cwd, created: r.created * 1000,
      state: g.asking ? 'waiting' : g.working ? 'working' : now - g.changedAt < WAITING_MS ? 'waiting' : 'idle',
      question: g.question, contextPct: g.contextPct, tokensK: g.tokensK, windowK: g.windowK,
      artifact: g.artifact, changedAt: g.changedAt,
    });
  }
  return { sessions, glances };
}

// ── Tabs, notifications, question card ──────────────────────────────

function orderTabs(old, sessions) {
  const there = new Set(sessions.map(s => s.id));
  const stays = old.filter(id => there.has(id));
  return [...stays, ...sessions.map(s => s.id).filter(id => !stays.includes(id))];
}

function nextWaiting(sessions, activeId) {
  const i = sessions.findIndex(s => s.id === activeId);
  for (let k = 1; k <= sessions.length; k++) {
    const s = sessions[(i + k) % sessions.length];
    if (s.id !== activeId && s.state === 'waiting') return s.id;
  }
  return null;
}

// Between two tool calls Claude briefly looks idle. So "done" only counts once the state has been
// STABLE for that many polls in a row (the app polls every 2 s). A question is unambiguous and notifies at once.
// memo: { [id]: { stable, candidate, times } }
const STABLE = 3;
function notifications(memo, sessions, visible, windowFocused) {
  const next = {}, out = [];
  for (const s of sessions) {
    const a = memo[s.id] || { stable: s.state, candidate: s.state, times: STABLE };
    const times = a.candidate === s.state ? a.times + 1 : 1;
    const e = { stable: a.stable, candidate: s.state, times };
    const asks = s.state === 'waiting' && s.question?.text;
    if ((times >= STABLE || asks) && e.stable !== s.state) {
      if (e.stable === 'working' && s.state === 'waiting' && !(windowFocused && visible.has(s.id))) {
        out.push(asks
          ? { id: s.id, title: `${title(s)} is asking`, body: s.question.text }
          : { id: s.id, title: `${title(s)} is done`, body: 'Waiting for you.' });
      }
      e.stable = s.state;
    }
    next[s.id] = e;
  }
  return { memo: next, notifications: out };
}

function card(sessions, visible) {
  const open = sessions
    .filter(s => s.question?.options?.length && !visible.has(s.id))
    .sort((a, b) => (a.changedAt || 0) - (b.changedAt || 0));
  return open.length ? { session: open[0], count: open.length } : null;
}

function newer(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

const backoff = attempt => [1000, 2000, 5000, 10000][attempt] ?? 30000;

// Command palette: prefix match before substring before scattered letters, otherwise stable.
function search(entries, text) {
  const f = text.trim().toLowerCase();
  if (!f) return entries;
  const rank = t => {
    t = t.toLowerCase();
    if (t.startsWith(f)) return 0;
    if (t.includes(f)) return 1;
    let i = 0;
    for (const c of t) if (c === f[i]) i++;
    return i === f.length ? 2 : 9;
  };
  return entries.map(e => [rank(e.text), e]).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0]).map(([, e]) => e);
}

// Context bar and the /compact hint measure against COMPACT_K (or the whole window, if smaller):
// quality drops long before a 1M window is full.
const COMPACT_K = 250;
function contextPercent(s) {
  if (s.tokensK != null) return Math.min(100, Math.round((s.tokensK / Math.min(COMPACT_K, s.windowK || COMPACT_K)) * 100));
  return s.contextPct ?? null;
}

// Clickable things in terminal text: artifact links, absolute image paths, code paths (optionally with :line).
const PATTERNS = [
  ['artifact', /https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/g],
  ['image', /(?<![\w.:/])\/[\w./@+-]+\.(?:png|jpe?g|gif|webp)\b/gi],
  ['file', /(?<![\w./@:-])\/?(?:[\w@.-]+\/)*[\w@-][\w@.-]*\.(?:m?js|cjs|tsx?|jsx|json|css|scss|html|py|md|sh|go|rs|swift|kt|java|ya?ml|toml|sql|php|astro|vue|svelte|txt|conf)(?::(\d+))?(?![\w/])/g],
];
function matches(text) {
  const out = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const target = kind === 'file' ? m[0].replace(/:\d+$/, '') : m[0];
      out.push({ kind, target, line: m[1] ? Number(m[1]) : 0, index: m.index, length: m[0].length });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

// Split a git diff into files. Drop header lines (index, ---, +++) only before the first hunk,
// otherwise a removed line "-- comment" would vanish as "--- comment".
function splitDiff(text) {
  const files = [];
  let cur = null, inHunk = false;
  for (const z of text.split('\n')) {
    if (z.startsWith('diff --git ')) {
      cur = { name: z.replace(/^diff --git a\/(.*) b\/.*$/, '$1'), lines: [], plus: 0, minus: 0 };
      files.push(cur);
      inHunk = false;
    } else if (!cur) continue;
    else if (!inHunk) {
      // Name from --- a/ (deleted file) or +++ b/, that is less ambiguous than the diff line.
      if (/^(\+\+\+ b|--- a)\//.test(z)) cur.name = z.slice(6);
      else if (z.startsWith('@@')) { inHunk = true; cur.lines.push(z); }
      else if (z.startsWith('Binary files')) cur.lines.push(z);
    } else if (z) {
      if (z[0] === '+') cur.plus++;
      else if (z[0] === '-') cur.minus++;
      cur.lines.push(z);
    }
  }
  return files;
}

// Claude's selection menu at the bottom of the screen: rows the cursor (❯) can reach, plus the cursor row.
// In multi-select, digits only toggle checkboxes; moving on goes through the "Next"/"Submit" row.
function readMenu(text) {
  const z = text.replace(/\s+$/, '').split('\n');
  const start = z.findLastIndex(l => /^\s*(?:❯\s*)?1\.\s/.test(l));
  if (start < 0) return null;
  const rows = [];
  let cursor = -1;
  for (const l of z.slice(start)) {
    const m = /^\s*(❯)?\s*(?:(\d+)\.\s+(.*?)|(Next|Submit))\s*$/.exec(l);
    if (!m) continue;
    if (m[1]) cursor = rows.length;
    rows.push(m[2] ? { n: Number(m[2]), text: m[3] } : { next: true });
  }
  return { rows, cursor };
}

// Split an option ("[✔] Apple") into text, checkbox and free text.
function option(o) {
  const m = /^\[(.)\]\s*(.*)$/.exec(o.text);
  const text = m ? m[2] : o.text;
  return { n: o.n, text, box: !!m, checked: m?.[1] === '✔', free: !!o.free || (!!m && /^Type something\.?$/.test(text)) };
}

// ── Prompt queue ────────────────────────────────────────────────────

// Which queued prompts go out now. A session must be calm (not working, no open question) for STABLE
// polls in a row, and gets at most one prompt per LOCK_MS, so a prompt is never sent twice into one pause.
const LOCK_MS = 20000;
function due(memo, sessions, queue, paused, now) {
  const next = {}, send = [];
  for (const s of sessions) {
    if (!queue[s.id]?.length) continue;
    const a = memo[s.id] || { calm: 0, sent: -Infinity };
    const e = { calm: s.state !== 'working' && !s.question ? a.calm + 1 : 0, sent: a.sent };
    if (e.calm >= STABLE && !paused.has(s.tmux) && now - e.sent > LOCK_MS) {
      send.push({ id: s.id, tmux: s.tmux, text: queue[s.id][0] });
      e.calm = 0; e.sent = now;
    }
    next[s.id] = e;
  }
  return { memo: next, send };
}

const State = {
  readPane, snapshot, WAITING_MS, readMenu, option, PALETTE, COMPACT_K, contextPercent, matches, splitDiff, search,
  color, title, orderTabs, nextWaiting, notifications, card, newer, backoff, due,
};
// Also usable in the renderer via <script> (no module there).
if (typeof module === 'object') module.exports = State; else window.State = State;
