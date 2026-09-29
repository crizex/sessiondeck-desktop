/* global deck, sessionById, titleOf, menu, closeMenu, toast, extra, el, activeId, drawTabs, tool, withSession, sessions */
// ── Queue: line up the next prompts, the app sends them as soon as the session is done (main/queue.js) ──

let queue = {}; // { id: { texts: [], since } }, under '*' the pool [{ text, folder, startAt }] (main/queue.js)
const POOL = '*';
const queueCount = id => (id === POOL ? 0 : queue[id]?.texts.length || 0);
const folderName = f => f.split('/').filter(Boolean).pop() || f;
deck.call('queue:list').then(q => { queue = q; drawTabs(); }).catch(() => {});
deck.on('queue:changed', q => {
  queue = q;
  drawTabs();
  if (!menu.hidden && menu.dataset.queue) queueMenu(menu.dataset.queue);
});
deck.on('queue:handed', ({ id, text, started }) => {
  const t = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  toast(started ? `No session was free, started a new one for: ${t}` : `Prompt went to ${titleOf(id)}: ${t}`);
});

function queueMenu(id) {
  const s = sessionById(id);
  if (!s) return;
  const head = el('div', 'bc-head');
  head.append(el('h2', '', `Queue · ${titleOf(id)}`));
  const note = el('p', 'q-note', s.state === 'working'
    ? 'Sent one at a time as soon as the session is done.'
    : 'The session is waiting, the first prompt goes out in a few seconds.');

  const list = el('ol', 'q-list');
  (queue[id]?.texts || []).forEach((t, i) => {
    const li = el('li');
    const remove = el('button', 'q-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove prompt ${i + 1}`);
    remove.addEventListener('click', () => deck.call('queue:remove', id, i));
    li.append(el('span', '', t), remove);
    list.append(li);
  });

  // Pool: for the next free session, whichever has time first
  const pool = el('ol', 'q-list q-pool');
  (queue[POOL]?.texts || []).forEach((a, i) => {
    const li = el('li');
    const remove = el('button', 'q-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove prompt ${i + 1} for the next free session`);
    remove.addEventListener('click', () => deck.call('queue:remove', POOL, i));
    let where = !a.folder ? 'any session' : sessions.some(x => x.cwd === a.folder) ? folderName(a.folder) : `${folderName(a.folder)}, no session open`;
    if (a.startAt) where += `, else a new session at ${new Date(a.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const text = el('span', '', a.text);
    text.append(el('small', '', where));
    li.append(text, remove);
    pool.append(li);
  });

  const field = el('textarea');
  field.rows = 3;
  field.placeholder = 'Next prompt for this session';
  field.setAttribute('aria-label', 'Prompt');
  const add = el('button', 'bc-send', 'Add to queue');
  add.type = 'button';
  const go = async () => {
    const text = field.value;
    if (!text.trim()) return field.focus();
    field.value = ''; // clear before waiting: the reply rebuilds the menu and keeps the draft
    await deck.call('queue:add', id, text).catch(e => toast(`Not queued: ${e.message}`));
  };
  add.addEventListener('click', go);
  const check = text => {
    const box = el('input');
    box.type = 'checkbox'; box.checked = true;
    const label = el('label', 'q-check');
    label.append(box, ` ${text}`);
    return [label, box];
  };
  const [onlyHereLabel, onlyHere] = check(`only sessions in ${folderName(s.cwd || '')}`);
  const [startLabel, start] = check('else start a new session after 2 min');
  const free = el('button', 'q-free', 'To next free');
  free.type = 'button';
  free.title = 'Goes to the first session that has been calm for a minute and has no prompts of its own';
  free.addEventListener('click', async () => {
    const text = field.value;
    if (!text.trim()) return field.focus();
    field.value = '';
    await deck.call('queue:pool', text, onlyHere.checked ? s.cwd : null, start.checked).catch(e => toast(`Not queued: ${e.message}`));
  });
  field.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } });
  const close = el('button', '', 'Close');
  close.type = 'button';
  close.addEventListener('click', closeMenu);
  const foot = el('div', 'buttons');
  foot.append(el('small', 'bc-tip', keyLabel('Ctrl+Enter adds')), close, free, add);

  const open = !menu.hidden && menu.dataset.queue === id;
  const draft = open ? menu.querySelector('textarea')?.value : '';
  if (open) [onlyHere.checked, start.checked] = [...menu.querySelectorAll('.q-check input')].map(x => x.checked).concat(true, true);
  menu.classList.add('palette', 'broadcast');
  menu.dataset.queue = id;
  menu.replaceChildren(head, note, ...(list.children.length ? [list] : []),
    ...(pool.children.length ? [el('p', 'q-note', 'For the next free session'), pool] : []), field, onlyHereLabel, startLabel, foot);
  menu.style.top = ''; menu.style.left = '';
  menu.hidden = false;
  field.value = draft || '';
  field.focus();
}
// Other menus reuse the element: forget the marker once it closes or shows something else.
new MutationObserver(() => { if (menu.hidden || !menu.querySelector('.q-note')) delete menu.dataset.queue; })
  .observe(menu, { attributes: true, attributeFilter: ['hidden'], childList: true });

tool('Queue: line up the next prompt (Ctrl+Shift+Q)', '<path d="M3 4h10M3 8h10M3 12h6"/><path d="M12 10.5v3M10.5 12h3"/>', withSession(queueMenu));
extra.palette.push(() => {
  const id = activeId();
  if (!id) return [];
  const n = queueCount(id);
  const p = queue[POOL]?.texts.length || 0;
  return [{ text: `Queue of ${titleOf(id)}${n ? ` (${n})` : ''}`, hint: 'Ctrl+Shift+Q', run: () => queueMenu(id) },
    { text: `Prompt for the next free session${p ? ` (${p} waiting)` : ''}`, hint: 'Queue', run: () => queueMenu(id) }];
});
extra.shortcuts.push((e, ctrl) => (ctrl && e.shiftKey && e.code === 'KeyQ' && activeId() ? () => queueMenu(activeId()) : null));
