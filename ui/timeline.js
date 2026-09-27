/* global deck, activeId, sessionById, titleOf, panelOpen, pvContent, el, esc, note, extra, pvRun: writable, errorText, filePreview, previewEl, tool, withSession */
// ── Timeline: every round of the session (prompt, answer, edits) as a dot, a click shows the round ──

let tl = null; // { id, nr, rounds, pick }

const tlTime = iso => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const clock = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? clock : `${d.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${clock}`;
};
const tlLines = t => (t ? t.replace(/\n$/, '').split('\n') : []);
const tlCount = parts => parts.reduce((a, t) => ({ plus: a.plus + tlLines(t.new).length, minus: a.minus + tlLines(t.old).length }), { plus: 0, minus: 0 });
const tlTotal = r => r.files.reduce((a, f) => { const n = tlCount(f.parts); return { plus: a.plus + n.plus, minus: a.minus + n.minus }; }, { plus: 0, minus: 0 });

async function timeline(id, pick) {
  const s = sessionById(id);
  if (!s) return;
  const nr = panelOpen({ kind: 'timeline', target: s.cwd || id }, id, `Timeline · ${titleOf(id)}`);
  if (tl?.id !== id || !tl.rounds) note('Loading rounds');
  let rounds;
  try { rounds = await deck.call('timeline:rounds', id); } catch (e) { if (nr === pvRun) note(`Timeline not loaded: ${errorText(e)}`); return; }
  if (nr !== pvRun) return;
  if (!rounds.length) { tl = null; return note('No rounds in this session yet.'); }
  // Reloaded while a round was open: stay there, otherwise show the newest.
  const old = tl?.id === id ? tl.rounds[tl.pick]?.time : null;
  const i = pick ?? (old ? rounds.findIndex(r => r.time === old) : -1);
  tl = { id, nr, rounds, pick: i >= 0 ? i : rounds.length - 1 };
  tlDraw();
}

function tlDraw() {
  const { rounds, pick, id } = tl;
  const bar = el('div', 'tl-bar');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Rounds');
  rounds.forEach((r, i) => {
    const n = tlTotal(r);
    const b = el('button', `tl-dot${r.files.length ? ' edit' : ''}`);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', i === pick);
    b.title = `${tlTime(r.time)}  ${r.prompt.slice(0, 120)}${r.files.length ? `\n${r.files.length} files, +${n.plus} -${n.minus}` : ''}`;
    b.addEventListener('click', () => { tl.pick = i; tlDraw(); tlFocus(); });
    bar.append(b);
  });

  const r = rounds[pick], n = tlTotal(r);
  const head = el('div', 'tl-head');
  const back = el('button', 'tl-step', '‹'), fwd = el('button', 'tl-step', '›');
  back.type = fwd.type = 'button';
  back.title = 'Previous round (arrow left)'; fwd.title = 'Next round (arrow right)';
  back.disabled = pick === 0; fwd.disabled = pick === rounds.length - 1;
  back.addEventListener('click', () => tlStep(-1));
  fwd.addEventListener('click', () => tlStep(1));
  head.append(back, el('span', 'tl-nr', `Round ${pick + 1} of ${rounds.length}`), el('span', 'tl-time', tlTime(r.time)),
    el('span', 'tl-tools', `${r.tools} tool calls${r.files.length ? `, ${r.files.length} files +${n.plus} -${n.minus}` : ''}`), fwd);

  const parts = [bar, head, el('h3', '', 'Prompt'), el('p', 'tl-prompt', r.prompt)];
  if (r.answer) parts.push(el('h3', '', 'Last answer'), el('p', 'tl-answer', r.answer));
  for (const f of r.files) {
    const d = el('details');
    d.open = r.files.length <= 3;
    const sum = el('summary');
    const name = el('button', 'pv-file', f.path);
    name.type = 'button';
    name.title = 'Open file (current state)';
    name.addEventListener('click', ev => { ev.preventDefault(); filePreview(f.path, 0, id); });
    const z = tlCount(f.parts);
    sum.append(name, el('span', 'plus', `+${z.plus}`), el('span', 'minus', `-${z.minus}`));
    const pre = el('pre');
    pre.innerHTML = f.parts.map(t => [
      t.old === null ? '<span class="hunk">written</span>' : '<span class="hunk">@@</span>',
      ...tlLines(t.old).map(x => `<span class="minus">-${esc(x)}</span>`),
      ...tlLines(t.new).map(x => `<span class="plus">+${esc(x)}</span>`),
    ].join('\n')).join('\n');
    d.append(sum, pre);
    parts.push(d);
  }
  pvContent.replaceChildren(...parts);
  bar.children[pick].scrollIntoView({ block: 'nearest', inline: 'center' });
}

function tlStep(d) {
  const i = tl.pick + d;
  if (i < 0 || i >= tl.rounds.length) return;
  tl.pick = i;
  tlDraw();
  tlFocus();
}
const tlFocus = () => pvContent.querySelector('.tl-dot[aria-selected="true"]')?.focus();

const tlOpen = () => tl && tl.nr === pvRun && !previewEl.hidden;

pvContent.addEventListener('keydown', e => {
  if (!tlOpen() || e.target.closest('input, textarea') || e.ctrlKey || e.altKey) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); tlStep(e.key === 'ArrowLeft' ? -1 : 1); }
});

// Claude finished a round: reload the open timeline of that session.
const tlBefore = new Map();
deck.onSessions(list => {
  for (const s of list) {
    if (tlBefore.get(s.id) === 'working' && s.state !== 'working' && tlOpen() && tl.id === s.id) timeline(s.id);
    tlBefore.set(s.id, s.state);
  }
});

tool('Session timeline (Ctrl+Shift+Z)', '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.3 2.3v2.5h2.5M8 5v3.2l2 1.3"/>', withSession(timeline));
extra.palette.push(() => (activeId() ? [{ text: 'Session timeline', hint: 'Ctrl+Shift+Z', run: () => timeline(activeId()) }] : []));
extra.shortcuts.push((e, ctrl) => (ctrl && e.shiftKey && e.code === 'KeyZ' && activeId() ? () => timeline(activeId()) : null));
