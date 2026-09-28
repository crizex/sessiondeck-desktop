/* global deck, activeId, sessionById, titleOf, panelOpen, pvContent, el, note, extra, pvRun, errorText, filePreview, toast, tool, withSession */
// ── Recap: what the session did, as facts from the transcript and git ──

const rcDuration = (a, b) => {
  const min = Math.round((new Date(b) - new Date(a)) / 60000);
  if (!(min >= 0)) return '';
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
};
const rcClock = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const rcSum = r => r.files.reduce((a, f) => ({ plus: a.plus + f.plus, minus: a.minus + f.minus }), { plus: 0, minus: 0 });
const rcCount = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// One line for the End dialog
const rcShort = r => {
  const z = rcSum(r);
  return [r.start && r.end && rcDuration(r.start, r.end), rcCount(r.commits.length, 'commit', 'commits'),
    r.files.length && `${rcCount(r.files.length, 'file', 'files')} +${z.plus} -${z.minus}`].filter(Boolean).join(' · ');
};

const rcCommitButton = id => {
  const b = el('button', 'pv-commit', 'Ask to commit');
  b.type = 'button';
  b.title = 'Adds the commit prompt from Settings to this session\'s queue';
  b.addEventListener('click', async () => {
    const text = (await deck.settings()).commitPrompt || 'commit and push';
    try { await deck.call('queue:add', id, text); } catch (e) { return toast(`Not queued: ${e.message}`); }
    b.disabled = true; b.textContent = 'Queued';
    toast(sessionById(id)?.state === 'working' ? 'Commit queued, goes out when the session is done' : 'Commit goes to the session in a moment');
  });
  return b;
};

async function recap(id) {
  const s = sessionById(id);
  if (!s) return;
  const nr = panelOpen({ kind: 'recap', target: s.cwd || id }, id, `Recap · ${titleOf(id)}`);
  note('Loading recap');
  let r;
  try { r = await deck.call('recap:load', id); } catch (e) { if (nr === pvRun) note(`Recap not loaded: ${errorText(e)}`); return; }
  if (nr !== pvRun) return;
  if (!r.rounds) return note('Nothing happened in this session yet.');
  const short = p => (s.cwd && p.startsWith(s.cwd + '/') ? p.slice(s.cwd.length + 1) : p);
  const file = p => {
    const b = el('button', 'pv-file', short(p));
    b.type = 'button';
    b.title = 'Open file';
    b.addEventListener('click', () => filePreview(p, 0, id));
    return b;
  };

  const numbers = el('div', 'rc-numbers');
  for (const [value, text] of [
    [rcDuration(r.start, r.end), `${rcClock(r.start)} to ${rcClock(r.end)}`],
    [r.rounds, r.rounds === 1 ? 'prompt' : 'prompts'],
    [r.tools, 'tool calls'],
    [r.output >= 1000 ? `${Math.round(r.output / 1000)}k` : r.output, 'tokens written'],
  ]) {
    const k = el('div', 'rc-number');
    k.append(el('b', '', String(value)), el('small', '', text));
    numbers.append(k);
  }
  const parts = [numbers];

  if (r.uncommitted.length) {
    const box = el('div', 'rc-open');
    const head = el('div', 'rc-open-head');
    head.append(el('b', '', `${rcCount(r.uncommitted.length, 'file', 'files')} not committed`), rcCommitButton(id));
    box.append(head, ...r.uncommitted.map(file));
    parts.push(box);
  }
  if (s.question?.text) parts.push(el('h3', '', 'Open question'), el('p', 'rc-text question', s.question.text));

  parts.push(el('h3', '', r.commits.length ? rcCount(r.commits.length, 'commit', 'commits') : 'No commits'));
  for (const c of r.commits) {
    const row = el('div', 'rc-commit');
    row.append(el('code', '', c.hash), el('span', '', c.text), el('small', '', `${c.repo} · ${rcClock(c.time)}`));
    parts.push(row);
  }

  const z = rcSum(r);
  parts.push(el('h3', '', r.files.length ? `${rcCount(r.files.length, 'file', 'files')} changed, +${z.plus} -${z.minus}` : 'No files changed'));
  for (const f of [...r.files].sort((a, b) => b.plus + b.minus - a.plus - a.minus)) {
    const row = el('div', 'rc-file');
    row.append(file(f.path), el('span', 'plus', `+${f.plus}`), el('span', 'minus', `-${f.minus}`));
    parts.push(row);
  }
  if (r.answer) parts.push(el('h3', '', 'Last answer'), el('p', 'rc-text', r.answer));
  pvContent.replaceChildren(...parts);
}

// For the End dialog (app.js): short line, warning about uncommitted files, button to the full recap.
function recapShort(id, done) {
  const box = el('div', 'rc-short');
  box.append(el('small', '', 'Loading recap'));
  deck.call('recap:load', id).then(r => {
    if (!r.rounds) return box.remove();
    const more = el('button', 'rc-more', 'Full recap');
    more.type = 'button';
    more.addEventListener('click', () => { done(); recap(id); });
    box.replaceChildren(el('span', '', rcShort(r)), more);
    if (r.uncommitted.length) box.prepend(el('b', 'rc-warning', `${rcCount(r.uncommitted.length, 'file', 'files')} not committed`));
  }).catch(() => box.remove());
  return box;
}

tool('Recap of the session (Ctrl+Shift+B)', '<path d="M5.5 2.5h5v2h-5zM5.5 3.5H3.5v10h9v-10h-2M5.5 8l1.5 1.5 3-3M5.5 11.5h5"/>', withSession(recap));
extra.palette.push(() => (activeId() ? [{ text: 'Recap of the session', hint: 'Ctrl+Shift+B', run: () => recap(activeId()) }] : []));
extra.shortcuts.push((e, ctrl) => (ctrl && e.shiftKey && e.code === 'KeyB' && activeId() ? () => recap(activeId()) : null));
