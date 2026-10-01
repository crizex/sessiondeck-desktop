/* global deck, $, el, openMenu, closeMenu, toast, extra */
// ── 5-hour limit at the top right: usage, reset, limit pause by hand ──

const limitButton = el('button', 'limit');
limitButton.type = 'button';
limitButton.hidden = true;
limitButton.innerHTML = '<span class="limit-text"></span><span class="limit-bar"><i></i></span>';
$('#tools').prepend(limitButton);
let limit = null;

const limitClock = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function limitDraw(l) {
  limit = l || limit;
  const u = limit || {}, paused = u.paused?.length;
  limitButton.hidden = u.pct == null && !paused;
  limitButton.className = `limit${paused ? ' paused' : u.pct >= 90 ? ' hot' : u.pct >= 70 ? ' warm' : ''}`;
  limitButton.querySelector('.limit-text').textContent = paused ? `Paused · ${paused}` : `${u.pct} %`;
  limitButton.querySelector('i').style.width = `${Math.min(100, u.pct ?? 0)}%`;
  limitButton.title = `5-hour limit ${u.pct ?? '?'} %` + (u.reset ? `, resets ${limitClock(u.reset)}` : '') + (paused ? `\n${paused} sessions paused` : '');
}
const limitLoad = () => deck.call('limit:status').then(limitDraw).catch(() => {});
deck.on('limit:changed', limitDraw);
deck.onStatus(st => { if (st === 'connected') limitLoad(); });
limitLoad();

async function limitMenu() {
  const [u, conf] = [limit || {}, await deck.settings().catch(() => ({}))];
  const paused = u.paused || [];
  const row = (a, b) => { const d = el('div', 'lm-row'); d.append(el('span', '', a), el('b', '', b)); return d; };
  const button = (text, what, busy) => {
    const b = el('button', '', text);
    b.type = 'button';
    b.addEventListener('click', async () => {
      if (what === 'pause' && !b.classList.contains('danger')) { b.classList.add('danger'); b.textContent = 'Really stop all working sessions?'; return; }
      b.disabled = true; b.textContent = busy;
      try {
        const n = await deck.call(`limit:${what}`);
        toast(what === 'pause' ? `${n} sessions paused` : `${n} sessions sent on`);
      } catch (e) { toast(`Limit pause: ${e.message}`); }
      closeMenu();
    });
    return b;
  };
  const content = [
    el('h2', 'lm-title', '5-hour limit'),
    row('Used', u.pct == null ? 'unknown' : `${u.pct} %`),
    row('Resets', u.reset ? limitClock(u.reset) : 'unknown'),
    u.week != null && row('This week', `${u.week} %`),
    row('Paused', paused.length ? paused.join(', ') : 'none'),
    el('p', 'lm-small', conf.limitPause
      ? `At ${conf.limitPause} % the limit pause stops every working session and sends it on after the reset.`
      : 'Automatic limit pause is off, set a percent in Settings to turn it on.'),
    button('Pause all working sessions now', 'pause', 'Pausing'),
    paused.length && button('Send paused sessions on', 'resume', 'Sending'),
  ].filter(Boolean);
  openMenu(limitButton, content);
}
limitButton.addEventListener('click', limitMenu);
extra.palette.push(() => [{ text: '5-hour limit and limit pause', hint: limit?.pct != null ? `${limit.pct} %` : '', run: limitMenu }]);
