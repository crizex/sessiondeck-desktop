/* global deck, activeId, sessionById, titleOf, panelOpen, pvContent, el, note, extra, pvRun, errorText, tool, withSession, tlTime */
// ── Messages this session exchanged with other sessions (SendMessage) ──

async function messages(id) {
  if (!sessionById(id)) return;
  const nr = panelOpen({ kind: 'messages', target: id }, id, `Messages · ${titleOf(id)}`);
  note('Loading messages');
  let list;
  try { list = await deck.call('messages:list', id); } catch (e) { if (nr === pvRun) note(`Messages not loaded: ${errorText(e)}`); return; }
  if (nr !== pvRun) return;
  if (!list.length) return note('This session has not exchanged messages with other sessions yet.');
  pvContent.replaceChildren(...list.reverse().map(n => {
    const a = el('article', `msg ${n.dir}`);
    const head = el('div', 'msg-head');
    head.append(el('span', 'msg-who', `${n.dir === 'in' ? 'from' : 'to'} ${n.who}`), el('time', '', tlTime(n.time)));
    a.append(head, el('p', 'msg-text', n.text));
    return a;
  }));
}

tool('Messages between sessions', '<path d="M2.5 4.5h8v5.5h-5l-3 2.5z"/><path d="M10.5 6.5h3v5.5l-2.2-1.8H7.5"/>', withSession(messages));
extra.palette.push(() => (activeId() ? [{ text: 'Messages between sessions', hint: 'Panel', run: () => messages(activeId()) }] : []));
