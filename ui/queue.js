/* global deck, sessionById, titleOf, menu, closeMenu, toast, extra, el, activeId, drawTabs, tool, withSession */
// ── Queue: line up the next prompts, the app sends them as soon as the session is done (main/queue.js) ──

let queue = {}; // { id: { texts: [], since } }
const queueCount = id => queue[id]?.texts.length || 0;
deck.call('queue:list').then(q => { queue = q; drawTabs(); }).catch(() => {});
deck.on('queue:changed', q => {
  queue = q;
  drawTabs();
  if (!menu.hidden && menu.dataset.queue) queueMenu(menu.dataset.queue);
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
  field.addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); go(); } });
  const close = el('button', '', 'Close');
  close.type = 'button';
  close.addEventListener('click', closeMenu);
  const foot = el('div', 'buttons');
  foot.append(el('small', 'bc-tip', 'Ctrl+Enter adds'), close, add);

  const draft = !menu.hidden && menu.dataset.queue === id ? menu.querySelector('textarea')?.value : '';
  menu.classList.add('palette', 'broadcast');
  menu.dataset.queue = id;
  menu.replaceChildren(head, note, ...(list.children.length ? [list] : []), field, foot);
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
  return [{ text: `Queue of ${titleOf(id)}${n ? ` (${n})` : ''}`, hint: 'Ctrl+Shift+Q', run: () => queueMenu(id) }];
});
extra.shortcuts.push((e, ctrl) => (ctrl && e.shiftKey && e.code === 'KeyQ' && activeId() ? () => queueMenu(activeId()) : null));
