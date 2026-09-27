/* global deck, $, activeId, sessionById, panelOpen, pvContent, previewEl, el, note, extra, recall, remember, pvRun, errorText, tool, withSession */
// ── Live preview: the session's web page as desktop and phone, reloads as soon as a file changes ──

const DESKTOP_W = 1280, PHONE = { w: 390, h: 844 }, BEZEL = 9, HEAD = 26, GAP = 12;
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
let live = null; // { id, nr, stage, status, ro }

const liveAddresses = () => recall('live-addresses', {});
const liveMode = () => recall('live-mode', 'both');

function button(text, run, title) {
  const b = el('button', '', text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', run);
  return b;
}

// The address is remembered per project folder; the first time the app asks for it.
function livePreview(id, ask = false) {
  const s = sessionById(id);
  if (!s?.cwd) return;
  const address = liveAddresses()[s.cwd];
  if (ask || !address) return askAddress(s, address || '');
  liveStop();
  liveOpen(s, address, panelOpen({ kind: 'live', target: s.cwd }, id, 'Live preview'));
}

async function liveOpen(s, address, nr) {
  note('Connecting');
  let r;
  try { r = await deck.call('live:open', address); } catch (e) {
    if (nr !== pvRun) return;
    const box = el('div', 'live-ask'), b = button('Change address', () => askAddress(s, address));
    b.className = 'st-button';
    box.append(el('p', 'pv-note', `Preview not started: ${errorText(e)}`), b);
    pvContent.replaceChildren(box);
    return;
  }
  if (nr !== pvRun) return;
  $('#pv-title').textContent = `Live · ${r.address}`;
  build(s, r, nr);
  deck.call('live:watch', s.id).catch(e => { if (live?.nr === nr) live.status.textContent = `Not watching: ${errorText(e)}`; });
}

// Address for the session folder, suggestion from package.json.
async function askAddress(s, old) {
  liveStop();
  const nr = panelOpen({ kind: 'live', target: s.cwd }, s.id, 'Set up live preview');
  const field = el('input');
  Object.assign(field, { type: 'text', placeholder: 'http://localhost:5173/', value: old || '', spellcheck: false });
  field.setAttribute('aria-label', 'Address of the page');
  const form = el('form', 'live-ask');
  form.append(el('h3', '', 'Which page belongs to this folder?'), el('p', 'live-where', s.cwd), field,
    el('p', 'live-small', 'localhost addresses go through a tunnel to the server, a port number alone works too. Remembered per folder.'),
    Object.assign(el('button', 'st-button', 'Open'), { type: 'submit' }));
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    const v = field.value.trim();
    if (!v) return field.focus();
    remember('live-addresses', { ...liveAddresses(), [s.cwd]: v });
    livePreview(s.id);
  });
  pvContent.replaceChildren(form);
  field.focus();
  if (!old) {
    const v = await deck.call('live:suggest', s.id).catch(() => '');
    if (nr === pvRun && v && !field.value) { field.value = v; field.select(); }
  }
}

function build(s, r, nr) {
  const mode = el('div', 'live-mode');
  mode.setAttribute('role', 'group');
  mode.setAttribute('aria-label', 'View');
  for (const [k, t] of [['both', 'Both'], ['desktop', 'Desktop'], ['phone', 'Phone']]) {
    const b = button(t, () => { remember('live-mode', k); fit(); });
    b.dataset.mode = k;
    mode.append(b);
  }
  const status = el('span', 'live-status', 'Starting to watch');
  status.setAttribute('aria-live', 'polite');
  const bar = el('div', 'live-bar');
  bar.append(mode, status, button('Reload', () => reload('by hand')), button('Address', () => askAddress(s, r.address), r.address));
  const stage = el('div', 'live-stage');
  stage.append(device('desktop', r), device('phone', r));
  pvContent.replaceChildren(bar, stage);
  const ro = new ResizeObserver(fit);
  ro.observe(stage);
  live = { id: s.id, nr, stage, status, ro };
}

function device(kind, r) {
  const box = el('div', `live-device ${kind}`);
  if (kind === 'desktop') {
    const head = el('div', 'live-head');
    head.append(el('i'), el('i'), el('i'), el('span', '', r.address));
    box.append(head);
  }
  const w = document.createElement('webview');
  w.partition = kind === 'phone' ? 'persist:live-phone' : 'persist:live'; // separate, Chromium remembers zoom per origin
  if (kind === 'phone') w.setAttribute('useragent', PHONE_UA);
  w.src = r.load;
  const error = el('p', 'live-error');
  error.hidden = true;
  w.addEventListener('dom-ready', () => {
    w.ready = true;
    w.setZoomFactor(Number(w.dataset.zoom) || 1);
    if (kind === 'phone') w.insertCSS('::-webkit-scrollbar { width: 0; height: 0; }'); // like on a phone: no scrollbar
  });
  w.addEventListener('did-fail-load', e => {
    if (!e.isMainFrame || e.errorCode === -3) return; // -3: aborted, e.g. by a new load
    error.textContent = `${r.address} does not answer (${e.errorDescription}). Is the dev server running?`;
    error.hidden = false;
  });
  w.addEventListener('did-finish-load', () => { if (!w.isLoadingMainFrame()) error.hidden = true; });
  const frame = el('div', 'live-frame');
  frame.append(w, error);
  box.append(frame);
  if (kind === 'phone') box.append(el('span', 'live-size', `${PHONE.w} × ${PHONE.h}`));
  return box;
}

// Sizes from the stage; the zoom turns the width into the wanted CSS width of the page.
function fit() {
  if (!live) return;
  const m = liveMode(), st = live.stage;
  const W = st.clientWidth - 2 * GAP, H = st.clientHeight - 2 * GAP;
  if (W <= 0 || H <= 0) return;
  for (const b of st.parentElement.querySelectorAll('.live-mode button')) b.setAttribute('aria-pressed', b.dataset.mode === m);
  const d = st.querySelector('.desktop'), p = st.querySelector('.phone');
  d.hidden = m === 'phone'; p.hidden = m === 'desktop';
  const stacked = m === 'both' && W < 640;
  st.classList.toggle('stacked', stacked);
  let dh = H, ph = H, pmax = W;
  if (stacked) { dh = Math.min(H * 0.55, W * 0.625 + HEAD); ph = H - dh - GAP; } else if (m === 'both') pmax = W * 0.42;
  const ps = Math.max(0.2, Math.min(1, (ph - 2 * BEZEL - 20) / PHONE.h, (pmax - 2 * BEZEL) / PHONE.w));
  if (m !== 'desktop') setSize(p, PHONE.w * ps, PHONE.h * ps, ps);
  if (m !== 'phone') {
    const dw = stacked || m === 'desktop' ? W : W - (PHONE.w * ps + 2 * BEZEL) - GAP;
    setSize(d, dw - 2, dh - HEAD - 2, (dw - 2) / DESKTOP_W);
  }
}

function setSize(box, w, h, zoom) {
  const v = box.querySelector('webview');
  v.style.width = `${Math.round(w)}px`;
  v.style.height = `${Math.max(40, Math.round(h))}px`;
  v.dataset.zoom = zoom;
  if (v.ready) v.setZoomFactor(zoom);
}

// Remember the scroll position and set it again after loading, in case the page gets its full height late.
async function reload(reason) {
  if (!live) return;
  const { status } = live;
  await Promise.all([...live.stage.querySelectorAll('webview')].filter(w => w.ready).map(async w => {
    const y = Number(await w.executeJavaScript('scrollY').catch(() => 0)) || 0;
    if (y) w.addEventListener('did-finish-load', () => w.executeJavaScript(`scrollTo(0, ${y})`).catch(() => {}), { once: true });
    w.reload();
  }));
  status.textContent = `Reloaded ${new Date().toLocaleTimeString()}, ${reason}`;
}

function liveStop() {
  if (!live) return;
  live.ro.disconnect();
  live = null;
  deck.call('live:stop').catch(() => {});
}

deck.on('live:changed', (id, file) => { if (live?.id === id) reload(file); });
deck.on('live:ready', (id, n, truncated) => {
  if (live?.id === id) live.status.textContent = `Watching ${n.toLocaleString()} files${truncated ? ' (truncated)' : ''}`;
});

// Panel closed, other content or other session: stop the watcher.
setInterval(() => {
  if (!live) return;
  if (live.nr !== pvRun || previewEl.hidden) return liveStop();
  const now = activeId();
  if (!now || now === live.id) return;
  if (liveAddresses()[sessionById(now)?.cwd]) return livePreview(now);
  liveStop();
  note('Session switched, live preview stopped. The screen button at the top starts it for the active session.');
}, 500);

tool('Live preview of the web page (Ctrl+Shift+L)', '<rect x="1.8" y="2.8" width="12.4" height="8.4" rx="1.5"/><path d="M5.5 14h5M8 11.2V14"/>', withSession(id => livePreview(id)));
extra.palette.push(() => {
  const id = activeId(), s = sessionById(id);
  if (!s?.cwd) return [];
  return [
    { text: 'Live preview', hint: 'Ctrl+Shift+L', run: () => livePreview(id) },
    { text: 'Live preview: change address', hint: 'Live', run: () => livePreview(id, true) },
  ];
});
extra.shortcuts.push((e, ctrl) => (ctrl && e.shiftKey && e.code === 'KeyL' ? () => livePreview(activeId()) : null));
