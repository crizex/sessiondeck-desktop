/* global deck, $, windowEl, toast, sessions, place, focus, sessionText, panelOpen, pvContent, pvRun, el, esc, errorText, terms, activeId, view, extra, tool, wanted: writable */
// ── Ctrl+Shift+F: search across all sessions (Claude transcripts of the last 30 days) ──
// Enter jumps into the running session or continues the conversation, Shift+Enter only shows it.

const saEl = el('div', 'search-all');
saEl.id = 'search-all';
saEl.hidden = true;
saEl.setAttribute('role', 'dialog');
saEl.setAttribute('aria-label', 'Search all sessions');
const saField = el('input');
Object.assign(saField, { type: 'search', placeholder: 'Search all sessions of the last 30 days', autocomplete: 'off' });
saField.setAttribute('aria-label', 'Search term');
saField.setAttribute('aria-controls', 'sa-list');
const saInfo = el('p', 'sa-info');
saInfo.setAttribute('aria-live', 'polite');
const saList = el('div', 'sa-list');
saList.id = 'sa-list';
saList.setAttribute('role', 'listbox');
const saFoot = el('p', 'sa-foot');
saFoot.innerHTML = '<kbd>Enter</kbd> open <kbd>Shift+Enter</kbd> view only <kbd>Esc</kbd> close';
saEl.append(saField, saInfo, saList, saFoot);
windowEl.append(saEl);

let saHits = [], saPick = 0, saNr = 0, saTimer = null, saTerm = '';

const saPattern = b => new RegExp(b.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'gi');
function saMarked(text, b) {
  let html = '', from = 0;
  for (const m of text.matchAll(saPattern(b))) { html += `${esc(text.slice(from, m.index))}<mark>${esc(m[0])}</mark>`; from = m.index + m[0].length; }
  return html + esc(text.slice(from));
}
// Home folders shortened to ~
const saFolder = cwd => String(cwd || '').replace(/^\/(home\/[^/]+|root)(?=\/|$)/, '~') || '/';
const saWho = { you: 'You', claude: 'Claude', tool: 'Tool' };
function saDate(ms) {
  const d = new Date(ms), today = new Date(), clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days === 0) return `today ${clock}`;
  if (days === 1) return `yesterday ${clock}`;
  return d.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' });
}
const saRunning = g => g.tmux && sessions.find(s => (s.tmux || s.id) === g.tmux);

function searchAll() {
  saEl.hidden = false;
  saField.focus();
  saField.select();
}
function saClose() {
  saEl.hidden = true;
  if (!view) terms.get(activeId())?.term.focus();
}

function saDraw() {
  saList.replaceChildren(...saHits.map((g, i) => {
    const b = el('button', i === saPick ? 'sa-hit on' : 'sa-hit');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', i === saPick);
    const head = el('span', 'sa-head');
    head.append(el('span', 'sa-folder', saFolder(g.cwd)), el('span', 'sa-date', saDate(g.time)));
    if (saRunning(g)) head.append(el('span', 'sa-running', 'running'));
    b.append(head, el('span', 'sa-title', g.title || 'No prompt'));
    for (const a of g.excerpts) {
      const z = el('span', `sa-excerpt who-${a.who}`);
      z.innerHTML = `<b>${saWho[a.who]}</b> ${saMarked(a.text, saTerm)}`;
      b.append(z);
    }
    b.addEventListener('click', e => saOpen(g, e.shiftKey));
    return b;
  }));
}

async function saSearch() {
  const b = saField.value.trim(), nr = ++saNr;
  if (b.length < 2) { saHits = []; saList.replaceChildren(); saInfo.textContent = ''; return; }
  saInfo.textContent = 'Searching';
  let r;
  try { r = await deck.call('search:all', b); } catch (e) { if (nr === saNr) saInfo.textContent = `Search failed: ${errorText(e)}`; return; }
  if (nr !== saNr) return;
  saTerm = b;
  saHits = r.conversations;
  saPick = 0;
  const n = saHits.length;
  saInfo.textContent = `${n === 40 ? 'The newest 40' : n} ${n === 1 ? 'conversation' : 'conversations'}, ${r.files} transcripts searched in ${(r.ms / 1000).toFixed(1)} s`;
  saDraw();
  if (!n) saList.replaceChildren(el('p', 'sa-empty', 'Nothing found. The search covers your prompts and Claude\'s answers, not tool output.'));
}

// Open a hit: a running session with Ctrl+F, otherwise continue it; viewOnly shows the history in the panel.
async function saOpen(g, viewOnly) {
  const b = saTerm;
  saEl.hidden = true;
  const s = saRunning(g);
  if (!viewOnly && s) {
    place(focus, s.id);
    sessionText(s.id); // creates the search field at once and searches for its content after loading
    const f = pvContent.querySelector('.pv-search input');
    if (f) f.value = b;
    return;
  }
  // Runs in a tmux session outside the app: do not put a second claude on the same conversation.
  if (!viewOnly && !g.tmux) {
    try {
      const created = await deck.call('search:resume', g.cwd, g.id, saFolder(g.cwd).split('/').pop());
      if (created?.id) wanted = created.id;
      return;
    } catch (e) { toast(`Conversation not continued: ${errorText(e)}`); }
  }
  if (!viewOnly && g.tmux) toast(`Runs in tmux session ${g.tmux}, shown read-only here.`);
  saHistory(g, b);
}

// Read only: the whole conversation in the preview panel, all hits marked, Enter jumps on.
async function saHistory(g, b) {
  // Keep the title short: a long #pv-title would make the whole area wider than the window.
  const nr = panelOpen({ kind: 'text', target: g.id }, null, `${saFolder(g.cwd)}, ${saDate(g.time)}: ${(g.title || '').slice(0, 50)}`);
  const info = el('span', 'pv-count', 'Loading conversation');
  info.setAttribute('aria-live', 'polite');
  const head = el('div', 'pv-search');
  head.append(el('span', 'sa-panel-term', `Matches for "${b}", read-only`), info);
  const pre = el('pre');
  pre.tabIndex = 0;
  pvContent.replaceChildren(head, pre);
  let text;
  try { text = await deck.call('search:history', g.id); } catch (e) { if (nr === pvRun) info.textContent = `Not loaded: ${errorText(e)}`; return; }
  if (nr !== pvRun) return;
  pre.innerHTML = saMarked(text, b);
  const marks = [...pre.querySelectorAll('mark')];
  let i = marks.length;
  const jump = d => {
    if (!marks.length) { info.textContent = 'no matches'; return; }
    marks[i]?.classList.remove('on');
    i = (i + d + marks.length) % marks.length;
    marks[i].classList.add('on');
    marks[i].scrollIntoView({ block: 'center' });
    info.textContent = `${i + 1} of ${marks.length}`;
  };
  jump(-1); // the newest hit first
  pre.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); jump(e.shiftKey ? 1 : -1); } });
  pre.focus({ preventScroll: true });
}

saField.addEventListener('input', () => { clearTimeout(saTimer); saTimer = setTimeout(saSearch, 250); });
saEl.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); saClose(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!saHits.length) return;
    saPick = (saPick + (e.key === 'ArrowDown' ? 1 : saHits.length - 1)) % saHits.length;
    saDraw();
    saList.children[saPick]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && e.target === saField) {
    e.preventDefault();
    clearTimeout(saTimer);
    if (saField.value.trim() !== saTerm) saSearch(); else if (saHits[saPick]) saOpen(saHits[saPick], e.shiftKey);
  }
});
document.addEventListener('mousedown', e => { if (!saEl.hidden && !saEl.contains(e.target)) saEl.hidden = true; });

tool('Search all sessions (Ctrl+Shift+F)', '<circle cx="7" cy="7" r="4.3"/><path d="m10.2 10.2 3.6 3.6"/>', searchAll);
extra.palette.push(() => [{ text: 'Search all sessions', hint: 'Ctrl+Shift+F', run: searchAll }]);
extra.shortcuts.push((e, ctrl) => (ctrl && e.shiftKey && e.code === 'KeyF' ? searchAll : null));
