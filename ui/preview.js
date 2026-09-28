/* global State, deck, $, area, recall, remember, terms, activeId, view, viewOff, sessionById, titleOf, visibleIds, toast */
// ── Preview next to the terminals: artifacts, images, code, diff, session history ──

const ARTIFACT = /^https:\/\/claude\.ai\/(code\/)?artifact\/[\w-]+/;
const previewEl = $('#preview'), pvContent = $('#pv-content'), pvHistory = $('#pv-history'), pvDivider = $('#pv-divider');
const LH = 18; // line height of the code view in px, must match --lh in app.css
let previewUrl = null, panelId = null, pvRun = 0;

const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const errorText = e => e.message.replace(/^Error invoking remote method '[\w:-]+': (Error: )?/, '');
const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
const note = text => pvContent.replaceChildren(el('p', 'pv-note', text));

const pvWidth = px => { previewEl.style.setProperty('--pv-width', `${px}px`); return px; };
if (recall('pv-width', 0)) pvWidth(recall('pv-width', 0));

// Drag the width; otherwise the webview swallows the mouse moves while the pointer is over it.
pvDivider.addEventListener('pointerdown', e => {
  const box = area.getBoundingClientRect(), w = previewEl.querySelector('webview');
  pvDivider.setPointerCapture(e.pointerId);
  pvDivider.classList.add('dragging');
  if (w) w.style.pointerEvents = 'none';
  let px = previewEl.getBoundingClientRect().width;
  const drag = ev => { px = pvWidth(Math.min(box.width - 320, Math.max(320, box.right - 10 - ev.clientX))); };
  pvDivider.addEventListener('pointermove', drag);
  pvDivider.addEventListener('pointerup', () => {
    pvDivider.removeEventListener('pointermove', drag);
    pvDivider.classList.remove('dragging');
    if (w) w.style.pointerEvents = '';
    remember('pv-width', px);
  }, { once: true });
});

// Clickable things in the terminal (link provider in app.js). Column = character index.
function previewLinks(text, y, id) {
  return State.matches(text).map(t => ({
    text: text.substr(t.index, t.length),
    range: { start: { x: t.index + 1, y }, end: { x: t.index + t.length, y } },
    activate: () => openEntry({ kind: t.kind, target: t.target, line: t.line }, id),
  }));
}

function openEntry(e, id) {
  if (e.kind === 'artifact') preview(e.target, id);
  else if (e.kind === 'image') imagePreview(e.target, id);
  else if (e.kind === 'file') filePreview(e.target, e.line, id);
  else if (e.kind === 'diff') diffPreview(id);
  else if (e.kind === 'live') livePreview(id); // live.js
  else if (e.kind === 'timeline') timeline(id); // timeline.js
}

// ── History per session: the last previews as chips ──

const HISTORY_MAX = 8;
const historyOf = id => recall('pv-history', {})[id] || [];
function rememberEntry(id, e) {
  if (!id) return;
  const all = recall('pv-history', {});
  const entry = { kind: e.kind, target: e.target, line: e.line || 0 };
  all[id] = [entry, ...(all[id] || []).filter(x => x.kind !== e.kind || x.target !== e.target)].slice(0, HISTORY_MAX);
  // Do not carry ended sessions around forever.
  for (const k of Object.keys(all)) if (k !== id && !sessionById(k)) delete all[k];
  remember('pv-history', all);
}
const chipText = e => ({ artifact: 'Artifact', diff: 'Diff', live: 'Live', timeline: 'Timeline' }[e.kind] || e.target.split('/').pop() + (e.line ? `:${e.line}` : ''));
function drawHistory(current) {
  const list = historyOf(panelId);
  pvHistory.hidden = list.length < 2;
  pvHistory.replaceChildren(...list.map(e => {
    const b = el('button', `chip ${e.kind}`, chipText(e));
    b.type = 'button';
    b.title = e.target;
    if (e.kind === current.kind && e.target === current.target) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => openEntry(e, panelId));
    return b;
  }));
}

// Show the panel; the run number keeps a slow old answer from overwriting a newer one.
function panelOpen(e, id, title) {
  if (view) viewOff();
  const nr = ++pvRun;
  previewEl.hidden = pvDivider.hidden = false;
  panelId = id ?? panelId;
  const web = e.kind === 'artifact';
  pvContent.hidden = web;
  pvContent.className = e.kind;
  pvContent.replaceChildren();
  $('#pv-external').hidden = !web;
  const w = previewEl.querySelector('webview');
  if (w) w.style.display = web ? '' : 'none';
  $('#pv-title').textContent = title;
  if (e.kind !== 'text') rememberEntry(panelId, e);
  drawHistory(e);
  if (web) artifactSeen(e.target);
  return nr;
}

function preview(url, id) {
  previewUrl = url;
  // Make it visible first: a webview created while hidden keeps a wrong width.
  panelOpen({ kind: 'artifact', target: url }, id, url.replace('https://', ''));
  let w = previewEl.querySelector('webview');
  if (!w) {
    w = document.createElement('webview');
    w.partition = 'persist:claude';
    w.src = url;
    previewEl.append(w);
  } else if (w.src !== url) w.src = url;
}

// Image from the server in the panel; a click switches between fitted and original size.
async function imagePreview(p, id) {
  const nr = panelOpen({ kind: 'image', target: p }, id, p);
  note('Loading image');
  try {
    const img = Object.assign(el('img'), { src: await deck.image(p), alt: p.split('/').pop() });
    if (nr !== pvRun) return;
    img.addEventListener('click', () => pvContent.classList.toggle('full'));
    pvContent.replaceChildren(img);
  } catch (e) {
    if (nr === pvRun) note(`Image not loaded: ${errorText(e)}`);
  }
}

// Code file with line numbers; a line reference (file.js:120) is marked and scrolled to.
async function filePreview(p, line, id) {
  const title = p + (line ? `:${line}` : '');
  const nr = panelOpen({ kind: 'file', target: p, line }, id, title);
  note('Loading file');
  let r;
  try { r = await deck.file(p, panelId); } catch (e) { if (nr === pvRun) note(`File not loaded: ${errorText(e)}`); return; }
  if (nr !== pvRun) return;
  $('#pv-title').textContent = r.path + (line ? `:${line}` : '');
  const box = el('div', 'pv-code');
  const numbers = Array.from({ length: r.lines }, (_, i) => i + 1).join('\n');
  box.innerHTML = `<pre class="nr" aria-hidden="true">${numbers}</pre><pre class="hljs"><code>${r.html}</code></pre>`;
  if (line > 0 && line <= r.lines) {
    const m = el('div', 'mark');
    m.style.top = `${(line - 1) * LH}px`;
    box.prepend(m);
  }
  pvContent.replaceChildren(box);
  pvContent.scrollTop = line ? (line - 8) * LH : 0;
}

// git diff of the files this session edited (working tree against HEAD), collapsible per file.
async function diffPreview(id) {
  const s = sessionById(id);
  if (!s?.cwd) return;
  const nr = panelOpen({ kind: 'diff', target: s.cwd }, id, `Changes by ${titleOf(id)}`);
  note('Loading changes');
  let r;
  try { r = await deck.diff(id); } catch (e) { if (nr === pvRun) note(`Diff not loaded: ${errorText(e)}`); return; }
  if (nr !== pvRun) return;
  const files = State.splitDiff(r.diff);
  if (!files.length && !r.fresh.length) return note(r.all ? 'No changes since the last commit.' : 'This session has no uncommitted edits.');
  // Names are absolute (other repos too); inside the session folder shorter.
  const short = name => (name.startsWith(s.cwd + '/') ? name.slice(s.cwd.length + 1) : name);
  const fileButton = name => {
    const b = el('button', 'pv-file', short(name));
    b.type = 'button';
    b.title = 'Open file';
    b.addEventListener('click', ev => { ev.preventDefault(); filePreview(name, 0, id); });
    return b;
  };
  const head = el('div', 'pv-diff-head');
  const commit = el('button', 'pv-commit', 'Ask to commit');
  commit.type = 'button';
  commit.title = 'Adds the commit prompt from Settings to this session\'s queue';
  commit.addEventListener('click', async () => {
    const text = (await deck.settings()).commitPrompt || 'commit and push';
    try { await deck.call('queue:add', id, text); } catch (e) { return toast(`Not queued: ${e.message}`); }
    commit.disabled = true; commit.textContent = 'Queued';
    toast(sessionById(id)?.state === 'working' ? 'Commit queued, goes out when the session is done' : 'Commit goes to the session in a moment');
  });
  head.append(el('p', 'pv-note', `${files.length} changed, ${r.fresh.length} new files${r.all ? ` in ${s.cwd} (no transcript found)` : ' by this session'}${r.truncated ? ' (truncated)' : ''}`), commit);
  const parts = [head];
  for (const f of files) {
    const d = el('details');
    d.open = files.length <= 3;
    const sum = el('summary');
    sum.append(fileButton(f.name), el('span', 'plus', `+${f.plus}`), el('span', 'minus', `-${f.minus}`));
    const pre = el('pre');
    pre.innerHTML = f.lines.map(z => `<span class="${z[0] === '+' ? 'plus' : z[0] === '-' ? 'minus' : z.startsWith('@@') ? 'hunk' : ''}">${esc(z)}</span>`).join('\n');
    d.append(sum, pre);
    parts.push(d);
  }
  if (r.fresh.length) {
    const fresh = el('div', 'pv-new');
    fresh.append(el('h3', '', 'New, not in git yet'), ...r.fresh.map(fileButton));
    parts.push(fresh);
  }
  pvContent.replaceChildren(...parts);
}

// Ctrl+F: search the session history (xterm itself has no scrollback in the alternate screen).
async function sessionText(id) {
  const s = sessionById(id);
  if (!s) return;
  const nr = panelOpen({ kind: 'text', target: id }, id, `History of ${titleOf(id)}`);
  const field = el('input');
  Object.assign(field, { type: 'search', placeholder: 'Search (Enter goes up, Shift+Enter down)' });
  field.setAttribute('aria-label', 'Search the history');
  const info = el('span', 'pv-count');
  info.setAttribute('aria-live', 'polite');
  const head = el('div', 'pv-search');
  head.append(field, info);
  const pre = el('pre', '', 'Loading history');
  pvContent.replaceChildren(head, pre);
  field.focus();
  let text;
  try { text = await deck.historyText(id); } catch (e) { if (nr === pvRun) pre.textContent = `History not loaded: ${errorText(e)}`; return; }
  if (nr !== pvRun) return;
  text = text.replace(/\s+$/, '');
  let marks = [], i = 0, timer = null, searched = '';
  const jump = d => {
    if (!marks.length) { info.textContent = field.value ? 'no matches' : ''; return; }
    marks[i]?.classList.remove('on');
    i = (i + d + marks.length) % marks.length;
    marks[i].classList.add('on');
    marks[i].scrollIntoView({ block: 'center' });
    info.textContent = `${i + 1} of ${marks.length}`;
  };
  const MAX_HITS = 2000; // more marks make the panel sluggish
  const find = () => {
    const f = searched = field.value;
    if (f.length < 2) { pre.textContent = text; marks = []; info.textContent = ''; return; }
    const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const all = [...text.matchAll(re)], hits = all.slice(-MAX_HITS);
    let html = esc(text.slice(0, hits[0]?.index ?? text.length)), from = hits[0]?.index ?? text.length;
    for (const m of hits) { html += `${esc(text.slice(from, m.index))}<mark>${esc(m[0])}</mark>`; from = m.index + m[0].length; }
    pre.innerHTML = html + esc(text.slice(from));
    marks = [...pre.querySelectorAll('mark')];
    i = marks.length - 1; // start at the bottom, the newest is there
    jump(0);
    if (all.length > MAX_HITS) info.textContent += ` (the newest of ${all.length})`;
  };
  pre.textContent = text;
  pvContent.scrollTop = pvContent.scrollHeight;
  if (field.value) find(); // typed while loading
  field.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(find, 150); });
  field.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); if (field.value !== searched) find(); else jump(e.shiftKey ? 1 : -1); }
    if (e.key === 'Escape') { e.preventDefault(); terms.get(activeId())?.term.focus(); }
  });
}

$('#pv-external').addEventListener('click', () => previewUrl && window.open(previewUrl));
$('#pv-close').addEventListener('click', () => { pvRun++; previewEl.hidden = pvDivider.hidden = true; terms.get(activeId())?.term.focus(); });

// ── New artifacts: a dot on the tab until they were opened once ──

let artSeed = recall('artifacts', null) === null; // very first start: everything already there counts as seen
const seen = new Set(recall('artifacts', []));
if (artSeed) remember('artifacts', []);
function artifactSeen(url) {
  if (seen.has(url)) return;
  seen.add(url);
  remember('artifacts', [...seen].slice(-200));
}
// New means: never opened and created while the session was not in view.
function artifactNew(s) {
  if (!s.artifact || seen.has(s.artifact)) return false;
  if (artSeed || visibleIds().includes(s.id)) { artifactSeen(s.artifact); return false; }
  return true;
}
deck.onSessions(list => { if (list.length) artSeed = false; });
