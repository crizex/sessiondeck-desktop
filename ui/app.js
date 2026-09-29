/* global Terminal, FitAddon, WebglAddon, State, deck, ARTIFACT, preview, previewLinks, artifactNew, sessionText, diffPreview */
const $ = s => document.querySelector(s);
const windowEl = $('#window'), tabsEl = $('#tabs'), frame = $('#frame'), area = $('#area'), store = $('#store');
const cardEl = $('#card'), pill = $('#pill'), banner = $('#banner'), menu = $('#menu');
// Short message at the top: goes away on its own or on click. Only the connection notice stays.
let toastTimer = null;
function toast(text, ms = 6000) {
  banner.textContent = text.replace(/Error invoking remote method '[\w:-]+': (Error: )?/, '');
  banner.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (connected) banner.hidden = true; }, ms);
}
banner.addEventListener('click', () => { if (connected) banner.hidden = true; });

let sessions = [], order = [], connected = false, wanted = null;
const terms = new Map(); // id -> { term, fit, el, channel, opened }
const panes = { l: { el: $('#left'), id: null }, r: { el: $('#right'), id: null } };
let focus = 'l', split = false;
let fontSize = 14; // from the settings, see below
let view = null; // null = terminals, otherwise 'web' or 'settings'

const remember = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const recall = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const wait = ms => new Promise(r => setTimeout(r, ms));
const sessionById = id => sessions.find(s => s.id === id);
// Own name and color per tab (double-click), only in this app; notifications keep the original name.
let custom = recall('custom', {});
const titleOriginal = id => (sessionById(id) ? State.title(sessionById(id)) : id);
const titleOf = id => custom[id]?.name || titleOriginal(id);
const colorOf = id => custom[id]?.color || State.color(titleOriginal(id));
const visibleIds = () => (view ? [] : [panes.l.id, split ? panes.r.id : null].filter(Boolean));
const activeId = () => panes[focus].id;
// Feature scripts (voice.js, live.js, ...) register here:
// palette: () => [{ text, hint, run }], shortcuts: (e, ctrl) => function or null
const extra = { palette: [], shortcuts: [] };

// ── Terminals ───────────────────────────────────────────────────────

const THEME = {
  background: '#0C0C0C', foreground: '#EAE7E1', cursor: '#EAE7E1', cursorAccent: '#0C0C0C',
  selectionBackground: '#FFD76A55',
  black: '#1C1D20', red: '#FF6B6B', green: '#4ADE9A', yellow: '#FFD76A', blue: '#6AB8FF', magenta: '#D7A6FF', cyan: '#5FE0D6', white: '#D8D5CF',
  brightBlack: '#6E6F76', brightRed: '#FF8F8F', brightGreen: '#7EF0B8', brightYellow: '#FFE39A', brightBlue: '#9AD0FF',
  brightMagenta: '#E6C6FF', brightCyan: '#8FF0E8', brightWhite: '#FFFFFF',
};

function terminal(id) {
  if (terms.has(id)) return terms.get(id);
  const term = new Terminal({
    fontFamily: '"Fragment Mono", "Cascadia Mono", Consolas, monospace', fontSize, lineHeight: 1.2,
    theme: THEME, allowProposedApi: true, scrollback: 5000, cursorBlink: true, macOptionClickForcesSelection: true,
    // OSC 8 links: artifacts into the preview, everything else into the browser.
    linkHandler: { activate: (_e, url) => (ARTIFACT.test(url) ? preview(url, id) : window.open(url)) },
  });
  // Artifact addresses, image and code paths in plain text become clickable (preview.js).
  // ponytail: column = character index, wide characters before it shift the hit; wrapped links are not detected.
  term.registerLinkProvider({
    provideLinks(y, cb) {
      const line = n => term.buffer.active.getLine(n)?.translateToString(true) ?? '';
      const links = previewLinks(line(y - 1), y, id, d => line(y - 1 + d));
      cb(links.length ? links : undefined);
    },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  const el = document.createElement('div');
  const t = { term, fit, el, channel: false, opened: false };
  term.onData(d => deck.write(id, d));
  // Selecting inside Claude Code arrives as OSC 52 (via tmux): copy to the clipboard like Windows Terminal.
  term.parser.registerOscHandler(52, data => {
    const b64 = data.slice(data.indexOf(';') + 1);
    if (b64 && b64 !== '?') {
      try { deck.copy(new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))); } catch {}
    }
    return true;
  });
  // Shift+drag selects in the terminal itself: copy right away.
  term.onSelectionChange(() => { if (term.hasSelection()) deck.copy(term.getSelection()); });
  term.onResize(({ cols, rows }) => t.channel && deck.resize(id, cols, rows));
  term.attachCustomKeyEventHandler(ev => {
    if (ev.type !== 'keydown') return true;
    if (shortcut(ev)) return false;
    // Ctrl+C copies when something is selected, otherwise it goes to Claude as an interrupt.
    if (ev.ctrlKey && !ev.altKey && ev.code === 'KeyC' && term.hasSelection()) {
      deck.copy(term.getSelection()); term.clearSelection(); ev.preventDefault(); return false;
    }
    // Ctrl+V and Alt+V: an image goes to the session as a file, otherwise text.
    if (ev.ctrlKey !== ev.altKey && !ev.shiftKey && ev.code === 'KeyV') { ev.preventDefault(); paste(id); return false; }
    return true;
  });
  terms.set(id, t);
  return t;
}

async function paste(id) {
  const t = terms.get(id);
  const r = await deck.paste(id).catch(e => ({ error: e.message.replace(/^Error invoking remote method '\w+': (Error: )?/, '') }));
  if (r.error) t?.term.write(`\r\n\x1b[90mPaste failed: ${r.error}\x1b[0m\r\n`);
  else if (r.text) t?.term.paste(r.text);
}

async function attach(id) {
  const t = terms.get(id);
  if (!t || t.channel || !connected || !sessionById(id)) return;
  t.channel = 'pending';
  try {
    t.term.reset();
    await deck.open(id, t.term.cols, t.term.rows);
    t.channel = true;
  } catch (e) {
    t.channel = false;
    t.term.write(`\r\n\x1b[90mCould not attach to the session: ${e.message}\x1b[0m\r\n`);
  }
}

function showInPane(side) {
  const p = panes[side];
  for (const child of [...p.el.children]) if (!child.classList.contains('pane-close')) store.appendChild(child);
  if (!p.id) return;
  const t = terminal(p.id);
  p.el.appendChild(t.el);
  if (!t.opened) {
    t.term.open(t.el);
    t.opened = true;
    try {
      const gl = new WebglAddon.WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      t.term.loadAddon(gl);
    } catch {}
  }
  t.fit.fit();
  if (t.channel === true) deck.resize(p.id, t.term.cols, t.term.rows);
  else attach(p.id);
}

const ro = new ResizeObserver(() => {
  // A hidden area has size 0: do not fit, tmux would shrink to 2 columns.
  if (!view) for (const s of ['l', 'r']) {
    const id = panes[s].id;
    if (id && (s === 'l' || split)) terms.get(id)?.fit.fit();
  }
  drawTabs();
});
// Observe panes one by one: the preview makes them narrower without the area changing.
for (const el of [area, panes.l.el, panes.r.el]) ro.observe(el);

deck.onData((id, d) => terms.get(id)?.term.write(d));
deck.onChannelClosed(id => {
  const t = terms.get(id);
  if (!t) return;
  t.channel = false;
  // Channel gone, session still there (for example the tmux client was detached): reattach visibly.
  if (connected && visibleIds().includes(id)) setTimeout(() => attach(id), 1500);
});

// ── Panes, split, focus ─────────────────────────────────────────────

function place(side, id) {
  if (!id || !sessionById(id)) return;
  viewOff();
  const other = side === 'l' ? 'r' : 'l';
  if (split && panes[other].id === id) { focus = other; return afterSwitch(); }
  panes[side].id = id;
  focus = side;
  showInPane(side);
  afterSwitch();
}

function splitWith(id) {
  if (!id || !sessionById(id) || id === panes.l.id) return;
  viewOff();
  split = true;
  $('#right').hidden = false; $('#divider').hidden = false;
  area.classList.add('split');
  ratio(recall('ratio', 0.5));
  panes.r.id = id;
  focus = 'r';
  showInPane('r');
  showInPane('l');
  afterSwitch();
}

// Take one side out of the split, the other one stays
const closeSide = side => { focus = side === 'l' ? 'r' : 'l'; unsplit(); };

function unsplit() {
  if (!split) return;
  if (focus === 'r') { panes.l.id = panes.r.id; }
  panes.r.id = null; split = false; focus = 'l';
  $('#right').hidden = true; $('#divider').hidden = true;
  area.classList.remove('split');
  panes.l.el.style.flex = '';
  showInPane('r'); showInPane('l');
  afterSwitch();
}

function ratio(x) {
  x = Math.min(0.8, Math.max(0.2, x));
  panes.l.el.style.flex = `${x} 1 0`;
  panes.r.el.style.flex = `${1 - x} 1 0`;
  return x;
}

$('#divider').addEventListener('pointerdown', e => {
  const d = e.currentTarget, box = area.getBoundingClientRect();
  d.setPointerCapture(e.pointerId);
  let x = 0.5;
  const drag = ev => { x = ratio((ev.clientX - box.left) / box.width); };
  d.addEventListener('pointermove', drag);
  d.addEventListener('pointerup', () => { d.removeEventListener('pointermove', drag); remember('ratio', x); }, { once: true });
});

for (const s of ['l', 'r']) panes[s].el.addEventListener('mousedown', () => { if (focus !== s) { focus = s; afterSwitch(false); } });

function afterSwitch(takeFocus = true) {
  for (const s of ['l', 'r']) {
    panes[s].el.classList.toggle('focus', s === focus);
    if (panes[s].id) panes[s].el.style.setProperty('--c', colorOf(panes[s].id));
  }
  const id = activeId();
  if (id) remember('active', id);
  if (takeFocus && id) terms.get(id)?.term.focus();
  $('#empty').hidden = !!panes.l.id || !connected;
  deck.visible(visibleIds());
  drawTabs();
  drawCard();
}

// ── Tabs ────────────────────────────────────────────────────────────

const STATE_TEXT = { working: 'working', waiting: 'waiting for you', idle: 'idle' };
function drawTabs() {
  const existing = new Map([...tabsEl.querySelectorAll('.tab:not(.fixed)')].map(b => [b.dataset.id, b]));
  order.forEach((id, i) => {
    const s = sessionById(id);
    let b = existing.get(id);
    if (!b) {
      b = document.createElement('button');
      b.type = 'button'; b.className = 'tab'; b.dataset.id = id;
      b.innerHTML = '<span class="icon"></span><span class="name"></span><span class="kbd"></span><span class="q" hidden></span><span class="ctx"><i></i></span>';
      b.addEventListener('click', e => (e.ctrlKey ? splitWith(id) : place(focus, id)));
      b.addEventListener('auxclick', e => { if (e.button === 1) splitWith(id); });
      b.addEventListener('contextmenu', e => { e.preventDefault(); askEnd(id, b); });
      b.addEventListener('dblclick', () => rename(id, b));
      b.draggable = true;
      b.addEventListener('dragstart', e => { e.dataTransfer.setData(SESSION_DRAG, id); e.dataTransfer.effectAllowed = 'move'; });
    }
    existing.delete(id);
    tabsEl.appendChild(b);
    b.style.setProperty('--c', colorOf(id));
    b.className = `tab ${s.state}` + (!view && id === activeId() ? ' on' : '') +
      (split && id === panes.l.id ? ' left' : '') + (split && id === panes.r.id ? ' right' : '') + (artifactNew(s) ? ' new' : '');
    b.querySelector('.name').textContent = titleOf(id);
    b.querySelector('.kbd').textContent = i < 9 ? i + 1 : '';
    const n = typeof queueCount === 'function' ? queueCount(id) : 0, qEl = b.querySelector('.q');
    qEl.hidden = !n; qEl.textContent = n; qEl.title = `${n} queued`;
    // Context bar: measured against State.COMPACT_K, not the whole window.
    const ctx = b.querySelector('.ctx'), p = State.contextPercent(s);
    ctx.hidden = p == null;
    ctx.className = `ctx${p >= 85 ? ' hot' : p >= 70 ? ' warm' : ''}`;
    ctx.firstChild.style.width = `${p ?? 0}%`;
    b.title = `${s.cwd}\n${STATE_TEXT[s.state] || ''}` +
      (s.tokensK != null ? `\nContext ${s.tokensK}k of ${State.COMPACT_K}k (${p} %)` : p == null ? '' : `\nContext ${p} % used`) +
      (b.classList.contains('new') ? '\nNew artifact' : '') + '\nDrag onto the terminal to open side by side';
    b.setAttribute('aria-current', !view && id === activeId() ? 'page' : 'false');
  });
  for (const b of existing.values()) b.remove();
  for (const b of document.querySelectorAll('.tab.fixed')) {
    b.classList.toggle('on', b.dataset.view === view);
    b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false');
  }

  const on = tabsEl.querySelector('.tab.on');
  if (on) {
    frame.style.opacity = 1;
    frame.style.left = `${on.offsetLeft}px`;
    frame.style.width = `${on.offsetWidth}px`;
    const middle = on.getBoundingClientRect().left + on.offsetWidth / 2;
    windowEl.style.setProperty('--glx', `${middle - 260}px`);
    windowEl.style.setProperty('--glow', view ? '#FF6B4A' : colorOf(activeId()));
  } else frame.style.opacity = 0;

  overlay(sessions.filter(s => s.state === 'waiting').length);
  drawCompact();
}

// From 85 % of State.COMPACT_K: a hint with a /compact button. Once dismissed it stays away until the context drops below 50 %.
const compactHidden = new Set();
function drawCompact() {
  const s = sessionById(activeId()), el = $('#compact');
  const p = s ? State.contextPercent(s) : null;
  for (const id of compactHidden) { const x = sessionById(id); if (!x || State.contextPercent(x) < 50) compactHidden.delete(id); }
  // Not while Claude works: /compact would queue behind the running task.
  el.hidden = !!view || !s || p == null || p < 85 || compactHidden.has(s.id) || s.state === 'working';
  if (!el.hidden) $('#compact-text').textContent = s.tokensK != null ? `Context ${s.tokensK}k of ${State.COMPACT_K}k` : `Context ${p} %`;
}
async function sendCompact(id) {
  const s = sessionById(id);
  if (!s) return;
  compactHidden.add(id);
  drawCompact();
  try {
    await deck.keys(s.tmux, ['-l', '/compact']);
    await wait(300);
    await deck.keys(s.tmux, ['Enter']);
  } catch (e) {
    compactHidden.delete(id);
    toast(`/compact not sent: ${e.message}`);
  }
}
$('#compact-go').addEventListener('click', () => sendCompact(activeId()));
$('#compact-hide').addEventListener('click', () => { compactHidden.add(activeId()); drawCompact(); terms.get(activeId())?.term.focus(); });

// Double-click on a tab: own name and color.
function rename(id, anchor) {
  const field = document.createElement('input');
  field.value = titleOf(id);
  field.placeholder = titleOriginal(id);
  field.setAttribute('aria-label', 'Tab name');
  const set = next => {
    const e = { ...custom[id], ...next };
    for (const k of Object.keys(e)) if (!e[k]) delete e[k];
    if (Object.keys(e).length) custom[id] = e; else delete custom[id];
    for (const k of Object.keys(custom)) if (!sessionById(k)) delete custom[k];
    remember('custom', custom);
    afterSwitch(false);
  };
  const name = () => (field.value.trim() === titleOriginal(id) ? '' : field.value.trim());
  field.addEventListener('keydown', e => { if (e.key === 'Enter') { set({ name: name() }); closeMenu(); } });
  const colors = document.createElement('div');
  colors.className = 'colors';
  colors.append(...State.PALETTE.map(f => {
    const b = document.createElement('button');
    b.type = 'button'; b.style.setProperty('--f', f); b.setAttribute('aria-label', `Color ${f}`);
    if (f === colorOf(id)) b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', () => { set({ name: name(), color: f }); closeMenu(); });
    return b;
  }));
  const reset = document.createElement('button');
  reset.type = 'button'; reset.textContent = 'Reset name and color';
  reset.addEventListener('click', () => { set({ name: '', color: '' }); closeMenu(); });
  openMenu(anchor, [field, colors, reset]);
  field.select();
}

let overlayLast = -1;
function overlay(n) {
  if (n === overlayLast) return;
  overlayLast = n;
  if (!n) return deck.overlay(null, 0);
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#FFD76A'; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1A1400'; g.font = '600 20px "Instrument Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(n > 9 ? '9+' : String(n), 16, 17);
  deck.overlay(c.toDataURL(), n);
}

// ── Sessions from the server ────────────────────────────────────────

deck.onSessions(list => {
  sessions = list;
  order = State.orderTabs(order, list);
  for (const [id, t] of terms) {
    if (!sessionById(id)) { t.term.dispose(); t.el.remove(); terms.delete(id); }
  }
  // A visible session ended: undo the split or switch to another one.
  if (split && !sessionById(panes.r.id)) { panes.r.id = null; focus = 'l'; unsplit(); }
  if (split && !sessionById(panes.l.id)) { focus = 'r'; unsplit(); }
  if (!sessionById(panes.l.id)) {
    panes.l.id = null;
    const target = [recall('active', null), ...order].find(id => sessionById(id));
    if (target) place('l', target); else { showInPane('l'); afterSwitch(false); }
  }
  if (wanted && sessionById(wanted)) { place(focus, wanted); wanted = null; }
  drawTabs();
  drawCard();
});

deck.onJump(id => { if (sessionById(id)) place(focus, id); else wanted = id; });

// ── Connection ──────────────────────────────────────────────────────

let countdown = null;
function setStatus(st, info) {
  clearInterval(countdown);
  connected = st === 'connected';
  $('#bar').classList.toggle('dim', !connected);
  if (connected) {
    banner.hidden = true;
    for (const id of visibleIds()) attach(id);
  } else {
    for (const t of terms.values()) t.channel = false;
    if (st === 'unconfigured') {
      banner.textContent = 'No server configured yet. Fill in the connection in Settings.';
      banner.hidden = false;
      showView('settings');
    } else if (st === 'error') {
      banner.textContent = info?.error || 'Connection failed';
      banner.hidden = false;
    } else {
      let rest = Math.round((info?.retryInMs || 1000) / 1000);
      const why = info?.error ? ` (${info.error})` : '';
      const text = () => { banner.textContent = `Disconnected${why}, retrying in ${rest} s`; };
      text(); banner.hidden = false;
      countdown = setInterval(() => { rest = Math.max(0, rest - 1); text(); }, 1000);
    }
  }
  $('#empty').hidden = !!panes.l.id || !connected;
  if (view === 'settings') drawStatus(st, info);
}
deck.onStatus(setStatus);
banner.textContent = 'Connecting';
banner.hidden = false;
deck.status().then(([st, info]) => { if (st !== 'disconnected' || info?.retryInMs) setStatus(st, info); });

// ── Question card ───────────────────────────────────────────────────

const answered = new Map(); // id -> question text, until a different question shows up
let collapsed = null, cardSession = null, freeOption = null;
let cardOptions = [], ticks = null; // ticks: checked numbers, only for multi-select
const cardKey = s => `${s.id}\n${s.question.text}`;

function drawCard() {
  for (const [id, text] of answered) if (sessionById(id)?.question?.text !== text) answered.delete(id);
  const open = sessions.filter(s => s.question && answered.get(s.id) !== s.question.text);
  const k = State.card(open, new Set(visibleIds()));
  if (!k) { cardEl.hidden = true; pill.hidden = true; cardSession = null; return; }
  if (collapsed === cardKey(k.session)) {
    cardEl.hidden = true; pill.hidden = false;
    pill.textContent = k.count > 1 ? `${k.count} questions open` : `${titleOf(k.session.id)} is asking`;
    return;
  }
  pill.hidden = true;
  const s = k.session;
  const min = s.changedAt ? Math.floor((Date.now() - s.changedAt) / 60000) : 0;
  $('#card-who').textContent = `${titleOf(s.id)} · ${min < 1 ? 'asking now' : `waiting for ${min} min`}`;
  $('#card-count').textContent = k.count > 1 ? `1 of ${k.count}` : '';
  if (cardSession?.id === s.id && cardSession.question.text === s.question.text) { cardSession = s; cardEl.hidden = false; return; }
  cardSession = s; freeOption = null;
  cardOptions = s.question.options.map(State.option);
  const multi = cardOptions.some(o => o.box);
  ticks = multi ? new Set(cardOptions.filter(o => o.checked).map(o => o.n)) : null;
  cardEl.classList.toggle('multi', multi);
  $('#card-question').textContent = s.question.text;
  $('#card-free').hidden = true;
  const button = (text, key, run) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = '<span></span><kbd></kbd>';
    b.firstChild.textContent = text;
    b.lastChild.textContent = key;
    b.addEventListener('click', run);
    return b;
  };
  $('#card-options').replaceChildren(...cardOptions.map(o => {
    const b = button(o.free ? 'Your own answer' : o.text, o.n, () => answer(o));
    if (o.box) b.dataset.n = o.n;
    return b;
  }), ...(multi ? [button('Next', 'Enter', next)] : []));
  if (multi) { $('#card-options').lastChild.className = 'next'; drawTicks(); }
  cardEl.hidden = false;
}

function drawTicks() {
  for (const b of $('#card-options').querySelectorAll('[data-n]')) b.setAttribute('aria-pressed', ticks.has(Number(b.dataset.n)));
}

// Finish a multi-select: cursor to "Next" or "Submit", then Enter.
async function next() {
  const s = cardSession;
  if (!s) return;
  answered.set(s.id, s.question.text);
  cardSession = null;
  drawCard();
  terms.get(activeId())?.term.focus();
  try {
    await deck.menuGo(s.tmux, 'next');
    await deck.keys(s.tmux, ['Enter']);
  } catch (e) {
    answered.delete(s.id);
    toast(`Answer not sent: ${e.message}`);
  }
}

async function answer(o) {
  const s = cardSession;
  if (!s) return;
  if (o.free) {
    freeOption = o;
    $('#card-free').hidden = false;
    $('#card-text').focus();
    return;
  }
  if (o.box) { // multi-select: the digit toggles the tick, the card stays open
    const on = !ticks.has(o.n);
    on ? ticks.add(o.n) : ticks.delete(o.n);
    drawTicks();
    await deck.keys(s.tmux, [String(o.n)]).catch(() => { on ? ticks.delete(o.n) : ticks.add(o.n); drawTicks(); });
    return;
  }
  answered.set(s.id, s.question.text);
  cardSession = null;
  drawCard();
  terms.get(activeId())?.term.focus();
  await deck.keys(s.tmux, [String(o.n)]).catch(() => answered.delete(s.id));
}

$('#card-free').addEventListener('submit', async e => {
  e.preventDefault();
  const s = cardSession, o = freeOption, text = $('#card-text').value.trim();
  if (!s || !o || !text) return;
  $('#card-text').value = '';
  if (o.box) {
    // Multi-select: move to the free text row and type, that ticks it. Enter comes with "Next".
    $('#card-free').hidden = true;
    ticks.add(o.n);
    const b = $(`#card-options [data-n="${o.n}"]`);
    if (b) b.firstChild.textContent = text;
    drawTicks();
    cardEl.focus();
    await deck.menuGo(s.tmux, o.n);
    await deck.keys(s.tmux, ['-l', text]);
    return;
  }
  answered.set(s.id, s.question.text);
  cardSession = null;
  drawCard();
  terms.get(activeId())?.term.focus();
  // The digit of "Type something." opens Claude's text field, then the text, then Enter.
  await deck.keys(s.tmux, [String(o.n)]);
  await wait(400);
  await deck.keys(s.tmux, ['-l', text]);
  await deck.keys(s.tmux, ['Enter']);
});

cardEl.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (cardSession) collapsed = cardKey(cardSession);
    cardSession = null;
    drawCard();
    terms.get(activeId())?.term.focus();
    return;
  }
  if (e.target.id === 'card-text') return;
  if (e.key === 'Enter' && ticks && e.target === cardEl) { e.preventDefault(); next(); return; }
  const o = cardSession && cardOptions.find(x => String(x.n) === e.key);
  if (o) { e.preventDefault(); answer(o); }
});
pill.addEventListener('click', () => { collapsed = null; drawCard(); cardEl.focus(); });

// ── Drag and drop: files onto a terminal ────────────────────────────

const MAX_MB = 100;
// Otherwise Electron opens a file dropped next to a pane as a page.
for (const ev of ['dragover', 'drop']) document.addEventListener(ev, e => e.preventDefault());
// Tab onto a terminal: unsplit, the right half opens it side by side, the left half shows it here;
// split, it replaces that side. Tab back onto the tab bar: take it out of the split.
const SESSION_DRAG = 'application/x-sessiondeck';
const dropMode = (e, p) => (split ? 'replace' : e.clientX > p.el.getBoundingClientRect().left + p.el.offsetWidth / 2 ? 'beside' : 'replace');
const dropOff = () => { for (const p of Object.values(panes)) p.el.classList.remove('target', 'target-beside'); tabsEl.classList.remove('target'); };
document.addEventListener('dragend', dropOff);
tabsEl.addEventListener('dragover', e => {
  if (!split || !e.dataTransfer.types.includes(SESSION_DRAG)) return;
  e.preventDefault();
  tabsEl.classList.add('target');
});
tabsEl.addEventListener('dragleave', e => { if (!tabsEl.contains(e.relatedTarget)) tabsEl.classList.remove('target'); });
tabsEl.addEventListener('drop', e => {
  const id = e.dataTransfer.getData(SESSION_DRAG);
  dropOff();
  if (split && id === panes.r.id) closeSide('r');
  else if (split && id === panes.l.id) closeSide('l');
});
for (const [side, p] of Object.entries(panes)) {
  const close = document.createElement('button');
  close.className = 'pane-close'; close.textContent = '×'; close.type = 'button';
  close.title = 'Take out of split (Ctrl+#)';
  close.setAttribute('aria-label', 'Take out of split');
  close.addEventListener('click', () => closeSide(side));
  p.el.appendChild(close);
  p.el.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes(SESSION_DRAG)) return;
    e.preventDefault();
    const beside = dropMode(e, p) === 'beside';
    p.el.classList.toggle('target-beside', beside);
    p.el.classList.toggle('target', !beside);
  });
  p.el.addEventListener('drop', e => {
    const id = e.dataTransfer.getData(SESSION_DRAG);
    if (!id) return;
    const mode = dropMode(e, p);
    dropOff();
    if (mode === 'beside') splitWith(id); else place(side, id);
  });
  p.el.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files') || !p.id) return;
    e.preventDefault();
    p.el.classList.add('target');
  });
  p.el.addEventListener('dragleave', e => { if (!p.el.contains(e.relatedTarget)) p.el.classList.remove('target', 'target-beside'); });
  p.el.addEventListener('drop', async e => {
    e.preventDefault();
    if (!e.dataTransfer.files.length) return;
    p.el.classList.remove('target');
    const id = p.id, t = terms.get(id);
    if (!id || !t) return;
    if (side !== focus) { focus = side; afterSwitch(); }
    for (const f of e.dataTransfer.files) {
      if (f.size > MAX_MB * 1e6) { t.term.write(`\r\n\x1b[90m${f.name} is larger than ${MAX_MB} MB, not uploaded.\x1b[0m\r\n`); continue; }
      try {
        const path = await deck.drop(f.name, new Uint8Array(await f.arrayBuffer()));
        deck.write(id, `${path} `);
      } catch (err) {
        t.term.write(`\r\n\x1b[90mUpload failed: ${err.message}\x1b[0m\r\n`);
      }
    }
    t.term.focus();
  });
}

// ── Menus: new session, end session ─────────────────────────────────

function openMenu(anchor, content) {
  menu.classList.remove('palette', 'broadcast');
  menu.replaceChildren(...content);
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 12)}px`;
}
const closeMenu = () => { menu.hidden = true; menu.classList.remove('palette', 'broadcast'); if (!view) terms.get(activeId())?.term.focus(); };
document.addEventListener('mousedown', e => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
menu.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

// "+": project folders below projectsRoot; a typed absolute path that matches nothing is used as is.
$('#plus').addEventListener('click', async e => {
  const anchor = e.currentTarget;
  const [list, conf] = await Promise.all([deck.projects().catch(() => []), deck.settings().catch(() => ({}))]);
  const templates = (conf.templates || []).map(line => {
    const t = State.template(line), b = document.createElement('button');
    b.type = 'button'; b.className = 'template';
    b.innerHTML = '<b></b><small></small>';
    b.firstChild.textContent = t.folder; b.lastChild.textContent = t.prompt || 'no prompt';
    b.addEventListener('click', () => { closeMenu(); startTemplate(line, conf); });
    return b;
  });
  const field = document.createElement('input');
  field.placeholder = 'Search project or type a path';
  field.setAttribute('aria-label', 'Search project');
  const buttons = document.createElement('div');
  const draw = () => {
    const f = field.value.toLowerCase();
    const hits = list.filter(p => p.toLowerCase().includes(f)).slice(0, 40);
    if (!hits.length && /^[/~]/.test(field.value.trim())) hits.push(field.value.trim());
    buttons.replaceChildren(...hits.map((p, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = p; if (i === 0) b.className = 'on';
      b.addEventListener('click', () => start(p));
      return b;
    }));
    if (!hits.length) buttons.innerHTML = '<p>No project folder found. Type an absolute path or set the projects folder in Settings.</p>';
  };
  const start = p => { closeMenu(); newSession(p); };
  field.addEventListener('input', draw);
  field.addEventListener('keydown', ev => { if (ev.key === 'Enter') buttons.querySelector('button')?.click(); });
  draw();
  openMenu(anchor, templates.length ? [el('p', 'templates-title', 'Templates'), ...templates, field, buttons] : [field, buttons]);
  field.focus();
});

async function newSession(p) {
  const created = await deck.create(p).catch(err => { toast(`Session not started: ${err.message}`); });
  if (created?.id) wanted = created.id;
  return created?.id;
}
// Template from the settings: start a session in the folder (relative = below projectsRoot), the prompt goes
// through the queue as soon as Claude is ready.
async function startTemplate(line, conf) {
  const t = State.template(line);
  const id = await newSession(/^[/~]/.test(t.folder) ? t.folder : `${(conf.projectsRoot || '~').replace(/\/$/, '')}/${t.folder}`);
  if (id && t.prompt) deck.call('queue:add', id, t.prompt, 15000).catch(e => toast(`Not queued: ${e.message}`));
}

// Buttons at the top right: everything with a shortcut also works with the mouse.
function tool(label, svg, run) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'tool'; b.title = label;
  b.setAttribute('aria-label', label.replace(/ \(.*\)$/, ''));
  b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true">${svg}</svg>`;
  b.addEventListener('click', run);
  $('#tools').insertBefore(b, $('#all-commands'));
  return b;
}
// Buttons that need an open session
const withSession = f => () => (activeId() ? f(activeId()) : toast('No session open'));
tool('All commands (Ctrl+K)', '<circle cx="3.5" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="12.5" cy="8" r=".8"/>', palette).id = 'all-commands';

// Ctrl+K: everything the app can do, by keyboard. Arrows pick, Enter runs.
async function palette() {
  const [projects, conf] = await Promise.all([deck.projects().catch(() => []), deck.settings().catch(() => ({}))]);
  const act = activeId(), actTab = () => tabsEl.querySelector(`.tab[data-id="${CSS.escape(act)}"]`);
  const entries = [
    ...order.map((id, i) => ({
      text: titleOf(id), hint: sessionById(id)?.state === 'waiting' ? 'waiting for you' : `Ctrl+${i + 1}`,
      run: () => place(focus, id),
    })),
    ...order.filter(id => id !== activeId()).map(id => ({ text: `Open beside: ${titleOf(id)}`, hint: 'split', run: () => splitWith(id) })),
    split && { text: 'Close split', hint: 'Ctrl+#', run: unsplit },
    { text: 'Next waiting session', hint: 'Alt+W', run: () => place(focus, State.nextWaiting(sessions, activeId())) },
    ...sessions.filter(artifactNew).map(s => ({ text: `New artifact: ${titleOf(s.id)}`, hint: 'Preview', run: () => preview(s.artifact, s.id) })),
    act && { text: 'Search this session history', hint: 'Ctrl+F', run: () => sessionText(act) },
    act && { text: 'Changes of this session (diff)', hint: 'Ctrl+Shift+D', run: () => diffPreview(act) },
    act && { text: `Send /compact to ${titleOf(act)}`, hint: 'Context', run: () => sendCompact(act) },
    act && { text: 'Rename tab or pick a color', hint: 'Double-click', run: () => actTab() && rename(act, actTab()) },
    ...(act ? conf.snippets || [] : []).map(t => ({ text: `Insert: ${t}`, hint: 'Snippet', run: () => { deck.write(act, t); terms.get(act)?.term.focus(); } })),
    conf.webUrl && { text: 'Web page', hint: 'Ctrl+0', run: () => showView('web') },
    { text: 'Settings', hint: 'Ctrl+,', run: () => showView('settings') },
    { text: 'Check for updates', hint: 'Settings', run: async () => { showView('settings'); await wait(300); $('#st-check')?.click(); } },
    ...(conf.templates || []).map(line => ({ text: `Template: ${line}`, hint: 'New session', run: () => startTemplate(line, conf) })),
    ...extra.palette.flatMap(f => f()),
    ...projects.map(p => ({ text: `New session: ${p}`, hint: 'Project', run: () => newSession(p) })),
  ].filter(Boolean);

  const field = document.createElement('input');
  field.placeholder = 'Session, project or command';
  field.setAttribute('aria-label', 'Search commands');
  const list = document.createElement('div');
  list.setAttribute('role', 'listbox');
  let hits = [], pick = 0;
  const draw = () => {
    hits = State.search(entries, field.value).slice(0, 12);
    pick = Math.min(pick, Math.max(0, hits.length - 1));
    list.replaceChildren(...hits.map((e, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', i === pick);
      if (i === pick) b.className = 'on';
      b.innerHTML = '<span></span><kbd></kbd>';
      b.firstChild.textContent = e.text; b.lastChild.textContent = e.hint || '';
      b.addEventListener('click', () => run(e));
      return b;
    }));
    if (!hits.length) list.innerHTML = '<p>Nothing found.</p>';
  };
  const run = e => { menu.hidden = true; menu.classList.remove('palette', 'broadcast'); if (!e) return; e.run(); };
  field.addEventListener('input', () => { pick = 0; draw(); });
  field.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      pick = (pick + (ev.key === 'ArrowDown' ? 1 : hits.length - 1)) % Math.max(1, hits.length);
      draw();
      list.children[pick]?.scrollIntoView({ block: 'nearest' });
    } else if (ev.key === 'Enter') run(hits[pick]);
  });
  draw();
  menu.classList.add('palette');
  menu.replaceChildren(field, list);
  menu.hidden = false;
  menu.style.top = ''; menu.style.left = '';
  field.focus();
}

function askEnd(id, anchor) {
  const p = document.createElement('p');
  p.textContent = `End session ${titleOf(id)}? Claude is closed there, unsaved work is lost.`;
  const yes = document.createElement('button');
  yes.type = 'button'; yes.className = 'danger'; yes.textContent = 'End';
  yes.addEventListener('click', async () => { closeMenu(); await deck.end(id).catch(() => {}); });
  const no = document.createElement('button');
  no.type = 'button'; no.textContent = 'Cancel';
  no.addEventListener('click', closeMenu);
  const row = document.createElement('div');
  row.className = 'buttons';
  row.append(no, yes);
  openMenu(anchor, [p, row]);
  no.focus();
  // recap.js: short recap above the buttons
  deck.settings().then(e => { if (e.recapOnEnd && typeof recapShort === 'function' && !menu.hidden) row.before(recapShort(id, closeMenu)); }).catch(() => {});
}

// ── Keyboard shortcuts ──────────────────────────────────────────────

function shortcut(e) {
  const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
  const digit = /^Digit([1-9])$/.exec(e.code);
  let run = null;
  if (ctrl && e.code === 'Digit0' && !e.shiftKey) run = () => webUrl && showView('web');
  else if (ctrl && e.key === ',') run = () => showView('settings');
  else if (ctrl && e.code === 'KeyK' && !e.shiftKey) run = palette;
  else if (ctrl && e.code === 'KeyF' && !e.shiftKey) run = () => sessionText(activeId());
  else if (ctrl && e.code === 'KeyD' && e.shiftKey) run = () => diffPreview(activeId());
  else if (ctrl && digit && !e.shiftKey) run = () => place(focus, order[digit[1] - 1]);
  else if (ctrl && digit && e.shiftKey) run = () => splitWith(order[digit[1] - 1]);
  else if (ctrl && e.key === 'Tab') run = () => {
    const i = order.indexOf(activeId()), n = order.length;
    place(focus, order[(i + (e.shiftKey ? n - 1 : 1)) % n]);
  };
  else if (ctrl && e.key === '#') run = unsplit;
  else if (e.altKey && !e.ctrlKey && e.code === 'KeyW') run = () => place(focus, State.nextWaiting(sessions, activeId()));
  else if (e.ctrlKey && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && split) run = () => {
    focus = e.key === 'ArrowLeft' ? 'l' : 'r'; afterSwitch();
  };
  for (const f of extra.shortcuts) run ??= f(e, ctrl);
  if (!run) return false;
  e.preventDefault();
  run();
  return true;
}

document.addEventListener('keydown', e => {
  if (e.target.closest?.('.xterm')) return; // attachCustomKeyEventHandler handles it there
  shortcut(e);
});

// ── Fixed views: optional web page and settings ─────────────────────

// The web page loads on first open and stays (login, scroll position).
let webUrl = '';
function webOpen(el) {
  if (el.firstChild || !webUrl) return;
  const w = document.createElement('webview');
  w.partition = 'persist:web';
  w.src = webUrl;
  w.setAttribute('allowpopups', '');
  el.append(w);
}
function setWebUrl(url) {
  webUrl = url || '';
  $('.tab[data-view="web"]').hidden = !webUrl;
  const el = $('#web'), w = el.firstChild;
  if (w && w.src !== webUrl) w.remove();
}

function showView(name) {
  view = name;
  area.hidden = true;
  const el = $(`#${name}`);
  for (const a of document.querySelectorAll('.view')) a.hidden = a !== el;
  if (el.classList.contains('webpage')) { webOpen(el); el.firstChild?.focus(); } else { el.tabIndex = -1; el.focus(); }
  if (name === 'settings') drawSettings();
  deck.visible([]);
  drawTabs();
  drawCard();
}

function viewOff() {
  if (!view) return;
  view = null;
  for (const a of document.querySelectorAll('.view')) a.hidden = true;
  area.hidden = false;
}

for (const b of document.querySelectorAll('.tab.fixed')) b.addEventListener('click', () => showView(b.dataset.view));
// Keys pressed inside an embedded page are sent here by main.js.
deck.onShortcut(k => shortcut({ ...k, ctrlKey: true, altKey: false, metaKey: false, preventDefault() {} }));

const settingsEl = $('#settings');
const UPDATE_TEXT = { current: 'You have the latest version.', ready: v => `Version ${v} is downloaded. Restart at the top right.` };
const escAttr = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function setFontSize(px) {
  fontSize = px;
  for (const t of terms.values()) { t.term.options.fontSize = px; if (t.opened) t.fit.fit(); }
}

const STATUS_TEXT = { connected: 'Connected', disconnected: 'Disconnected', unconfigured: 'Not configured', error: 'Error' };
function drawStatus(st, info) {
  const el = $('#st-status');
  if (!el) return;
  el.textContent = STATUS_TEXT[st] + (info?.error ? `: ${info.error}` : '');
  el.dataset.state = st;
}

async function drawSettings() {
  const e = await deck.settings();
  const c = e.connection;
  const toggle = (name, label, text, on, off) => `
    <label class="st-row"><span><b>${label}</b><small>${text}</small></span>
      <input type="checkbox" role="switch" data-name="${name}" ${on ? 'checked' : ''} ${off ? 'disabled' : ''}></label>`;
  const input = (name, label, text, value, extra = '') => `
    <label class="st-row"><span><b>${label}</b><small>${text}</small></span>
      <input class="st-input" name="${name}" value="${escAttr(value)}" spellcheck="false" autocomplete="off" ${extra}></label>`;
  settingsEl.innerHTML = `
    <header class="st-head"><h1>Settings</h1><span class="st-quiet">SessionDeck ${e.version}</span></header>
    <form class="st-list" id="st-connection">
      <h2>Server <span id="st-status"></span></h2>
      ${input('host', 'Host', 'Name or IP of the machine that runs tmux and Claude Code.', c.host, 'required placeholder="server.example.com"')}
      ${input('port', 'Port', 'SSH port.', c.port, 'type="number" min="1" max="65535"')}
      ${input('username', 'User', 'SSH user. Every tmux session of this user shows up as a tab.', c.username, 'required placeholder="dev"')}
      ${input('privateKeyPath', 'Private key', 'Path on this computer, for example ~/.ssh/id_ed25519. Passwords are not supported.', c.privateKeyPath, 'placeholder="~/.ssh/id_ed25519"')}
      ${input('agent', 'ssh-agent', 'Empty, "auto" (OpenSSH agent), "pageant" or a socket or pipe path.', c.agent, 'placeholder="auto"')}
      <div class="st-row"><span><b>Host key</b><small>${c.hostKey ? escAttr(c.hostKey) : 'Not seen yet, stored on first connect.'}</small></span>
        <label class="st-check"><input type="checkbox" name="resetHostKey"> Forget on save</label></div>
      <div class="st-row st-actions"><button type="submit" class="st-button">Save and connect</button></div>
    </form>
    <div class="st-list">
      <h2>Sessions</h2>
      ${input('projectsRoot', 'Projects folder', 'On the server. Its subfolders are offered for new sessions.', e.projectsRoot, 'data-name="projectsRoot"')}
      ${input('claudeCommand', 'Claude command', 'Runs in a login shell inside the new tmux session.', e.claudeCommand, 'data-name="claudeCommand"')}
      ${input('commitPrompt', 'Commit prompt', 'What "Ask to commit" in the diff view queues for the session.', e.commitPrompt, 'data-name="commitPrompt" placeholder="commit and push"')}
      ${input('webUrl', 'Web page', 'Optional. Shown as the first tab (Ctrl+0), for example a web session manager.', e.webUrl, 'data-name="webUrl" placeholder="https://"')}
      <label class="st-row st-block"><span><b>Snippets</b><small>One text per line. In Ctrl+K under "Insert", typed into the prompt without Enter.</small></span>
        <textarea data-name="snippets" rows="4" spellcheck="false"></textarea></label>
      <label class="st-row st-block"><span><b>Templates</b><small>One per line: folder | prompt. Shown on top of the + menu, they start a session and send the prompt once it is ready. A relative folder is below the projects folder.</small></span>
        <textarea data-name="templates" rows="3" spellcheck="false" placeholder="api | run the tests and fix what fails"></textarea></label>
    </div>
    <div class="st-list">
      <h2>App</h2>
      <div class="st-row"><span><b>Updates</b><small id="st-update">Checks on connect and every 30 minutes (installed Windows app only).</small></span>
        <button type="button" class="st-button" id="st-check">Check for updates</button></div>
      ${toggle('autostart', 'Start with Windows', 'Starts hidden in the tray.', e.autostart, !e.packaged)}
      ${toggle('notifications', 'Notifications', 'Tells you when a session waits for you.', e.notifications)}
      ${toggle('recapOnEnd', 'Recap when ending', 'The End dialog shows duration, commits and files that are not committed yet.', e.recapOnEnd)}
      ${toggle('voice', 'Voice input', 'Needs the optional voice service on the server, see README. Reload after switching.', e.voice)}
      <label class="st-row"><span><b>Terminal font size</b><small>Applies to all sessions at once.</small></span>
        <select data-name="fontSize">${[12, 13, 14, 15, 16, 18].map(n => `<option ${n === e.fontSize ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </div>`;
  for (const t of settingsEl.querySelectorAll('textarea')) t.value = (e[t.dataset.name] || []).join('\n');
  deck.status().then(([st, info]) => drawStatus(st, info));
}

settingsEl.addEventListener('submit', async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  await deck.connect({ ...f, resetHostKey: f.resetHostKey === 'on' });
  drawSettings();
});
settingsEl.addEventListener('change', e => {
  const n = e.target.dataset.name;
  if (!n) return;
  const value = n === 'fontSize' ? Number(e.target.value)
    : n === 'snippets' || n === 'templates' ? e.target.value.split('\n').map(t => t.trim()).filter(Boolean)
      : e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim();
  deck.setting(n, value);
  if (n === 'fontSize') setFontSize(value);
  if (n === 'webUrl') setWebUrl(value);
});
settingsEl.addEventListener('click', async e => {
  if (e.target.id !== 'st-check') return;
  const b = e.target, text = $('#st-update');
  b.disabled = true; b.textContent = 'Checking';
  const r = await deck.checkUpdate().catch(err => ({ result: `Error: ${err.message}` })) || { result: 'current' };
  const t = UPDATE_TEXT[r.result];
  text.textContent = typeof t === 'function' ? t(r.version) : t || r.result;
  b.disabled = false; b.textContent = 'Check for updates';
});
deck.settings().then(e => { if (e.fontSize !== fontSize) setFontSize(e.fontSize); setWebUrl(e.webUrl); });

// ── Update ──────────────────────────────────────────────────────────

// "Remind me tomorrow" holds per version; a newer version shows right away.
const DAY = 24 * 60 * 60 * 1000;
let updateVersion = null;
const updateShow = () => { $('#update').hidden = false; };
deck.onUpdate(({ version }) => {
  updateVersion = version;
  $('#update-text').textContent = `Version ${version}`;
  const l = recall('update-later', {});
  setTimeout(updateShow, l.version === version ? Math.max(0, l.until - Date.now()) : 0);
});
$('#update-later').addEventListener('click', () => {
  remember('update-later', { version: updateVersion, until: Date.now() + DAY });
  $('#update').hidden = true;
  setTimeout(updateShow, DAY);
});
$('#update-button').addEventListener('click', () => deck.restart());

setInterval(drawCard, 30000); // keep "waiting for X min" counting
document.fonts.load('14px "Fragment Mono"').then(() => { for (const t of terms.values()) t.opened && t.fit.fit(); });
