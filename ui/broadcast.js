/* global deck, sessions, titleOf, menu, closeMenu, toast, extra, el, terms, activeId, tool */
// ── Broadcast: one text to several sessions at once (e.g. "commit and push") ──

async function broadcast() {
  const conf = await deck.settings().catch(() => ({}));
  const field = el('textarea');
  field.rows = 3;
  field.placeholder = 'Message to several sessions';
  field.setAttribute('aria-label', 'Message');

  const chips = el('div', 'bc-snippets');
  for (const t of conf.snippets || []) {
    const b = el('button', 'chip', t);
    b.type = 'button';
    b.addEventListener('click', () => { field.value = field.value ? `${field.value} ${t}` : t; field.focus(); check(); });
    chips.append(b);
  }

  // Waiting sessions are preselected, working ones get the text into Claude's queue.
  const list = el('div', 'bc-list');
  const boxes = sessions.map(s => {
    const row = el('label', 'bc-session');
    const k = Object.assign(el('input'), { type: 'checkbox', checked: s.state === 'waiting' });
    k.dataset.id = s.id;
    k.addEventListener('change', check);
    row.append(k, el('span', '', titleOf(s.id)), el('small', '', s.state || ''));
    list.append(row);
    return k;
  });
  const all = el('button', 'bc-all', 'All');
  all.type = 'button';
  all.addEventListener('click', () => { const on = boxes.some(k => !k.checked); for (const k of boxes) k.checked = on; check(); });

  const send = el('button', 'bc-send', 'Send');
  send.type = 'button';
  function check() {
    const n = boxes.filter(k => k.checked).length;
    send.textContent = n ? `Send to ${n} session${n > 1 ? 's' : ''}` : 'Send';
    send.disabled = !n || !field.value.trim();
  }
  async function go() {
    const text = field.value.trim().replace(/\s*\n\s*/g, ' '); // a line break would submit in Claude right away
    const targets = boxes.filter(k => k.checked).map(k => sessions.find(s => s.id === k.dataset.id)).filter(Boolean);
    if (!text || !targets.length) return;
    closeMenu();
    const failed = [];
    await Promise.all(targets.map(async s => {
      try { await deck.keys(s.tmux, ['-l', text]); await deck.keys(s.tmux, ['Enter']); } catch { failed.push(titleOf(s.id)); }
    }));
    toast(failed.length ? `Broadcast did not reach: ${failed.join(', ')}` : `Broadcast sent to ${targets.length} session${targets.length > 1 ? 's' : ''}`);
    terms.get(activeId())?.term.focus();
  }
  send.addEventListener('click', go);
  field.addEventListener('input', check);
  field.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } });

  const head = el('div', 'bc-head');
  head.append(el('h2', '', 'Broadcast'), all);
  const foot = el('div', 'buttons');
  const cancel = el('button', '', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', closeMenu);
  foot.append(el('small', 'bc-tip', keyLabel('Ctrl+Enter sends')), cancel, send);

  menu.classList.add('palette', 'broadcast');
  menu.replaceChildren(head, field, ...(chips.children.length ? [chips] : []), list, foot);
  menu.style.top = ''; menu.style.left = '';
  menu.hidden = false;
  check();
  field.focus();
}

tool('Broadcast to several sessions (Ctrl+Shift+R)', '<path d="M2.5 6.2v3.6h2.3l5.7 3V3.2L4.8 6.2z"/><path d="M12.6 6.2a2.5 2.5 0 0 1 0 3.6"/>', broadcast);
extra.palette.push(() => (sessions.length > 1 ? [{ text: 'Broadcast to several sessions', hint: 'Ctrl+Shift+R', run: broadcast }] : []));
extra.shortcuts.push((e, ctrl) => (ctrl && e.shiftKey && e.code === 'KeyR' ? broadcast : null));
