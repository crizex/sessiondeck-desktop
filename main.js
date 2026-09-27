const fs = require('fs');
const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, globalShortcut, clipboard, shell, session } = require('electron');
const path = require('path');
const hljs = require('highlight.js');
const { Connection, q, rq } = require('./connection');
const State = require('./state');
const updater = require('./updater');

const ICON = path.join(__dirname, 'assets', 'icon.png');
const SNAPSHOT = fs.readFileSync(path.join(__dirname, 'server', 'snapshot.py'), 'utf8');
const TRANSCRIPT = fs.readFileSync(path.join(__dirname, 'server', 'transcript.py'), 'utf8');

// Own data folder (tests, several profiles side by side); otherwise the single-instance lock ends every second start.
if (process.env.SESSIONDECK_DATA) app.setPath('userData', process.env.SESSIONDECK_DATA);
if (!app.requestSingleInstanceLock()) app.exit(0);
app.setAppUserModelId('io.github.crizex.sessiondeck');

let win = null, tray = null, quitting = false;

// ── Settings: userData/settings.json, see settings.example.json ─────

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  connection: { host: '', port: 22, username: '', privateKeyPath: '', agent: '', hostKey: '' },
  projectsRoot: '~', claudeCommand: 'claude', webUrl: '',
  voice: false, notifications: true, fontSize: 14,
  snippets: ['continue', 'run the tests and fix what fails', 'commit and push'],
};
let settings = structuredClone(DEFAULTS);
function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
    settings = { ...structuredClone(DEFAULTS), ...s, connection: { ...DEFAULTS.connection, ...s.connection } };
  } catch {}
}
function saveSettings() {
  try { fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2), { mode: 0o600 }); } catch (e) { console.error('settings:', e.message); }
}

// Embedded pages: the optional web tab (webUrl), artifact preview on claude.ai, live preview.
const webOrigin = () => { try { return settings.webUrl ? new URL(settings.webUrl).origin : null; } catch { return null; } };
const isWeb = url => !!webOrigin() && url.startsWith(webOrigin() + '/');
// Artifact preview: own session so the claude.ai login stays. Google only for the login.
const PREVIEW = ['https://claude.ai/', 'https://accounts.google.com/'];
const LIVE = /^persist:live(-phone)?$/, httpPage = url => /^https?:\/\//.test(url);
const allowed = (wc, url) => isWeb(url) || (wc.session.storagePath?.endsWith('claude') && PREVIEW.some(v => url.startsWith(v)))
  || (/[\\/]live(-phone)?$/.test(wc.session.storagePath || '') && httpPage(url));

let sessions = [], glances = {}, memo = {}, visible = new Set(), ready = null, readyVersion = null;
const channels = new Map(); // id -> ssh2 channel
const conn = new Connection(settings.connection, () => saveSettings());

const send = (...a) => win && !win.isDestroyed() && win.webContents.send(...a);
const show = () => { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); };

// sessiondeck://open?id=<tmux session> from the command line or a second start
function linkFrom(argv) {
  const url = argv.find(a => a.startsWith('sessiondeck://'));
  if (!url) return null;
  try { return new URL(url).searchParams.get('id'); } catch { return null; }
}
function jump(id) { show(); if (id) send('jump', id); }
app.on('second-instance', (_e, argv) => jump(linkFrom(argv)));

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 640, minHeight: 400,
    backgroundColor: '#050505', icon: ICON, show: !process.argv.includes('--hidden'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#050505', symbolColor: '#A4A4AB', height: 46 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (httpPage(url)) shell.openExternal(url); return { action: 'deny' }; });
  const first = linkFrom(process.argv);
  if (first) win.webContents.once('did-finish-load', () => send('jump', first));
}

// ── Poll tmux, notifications ────────────────────────────────────────

let polling = false;
async function poll() {
  if (conn.status !== 'connected' || polling) return;
  polling = true;
  try {
    const r = State.snapshot(JSON.parse(await conn.exec(`python3 -c ${q(SNAPSHOT)}`)), glances, Date.now());
    sessions = r.sessions; glances = r.glances;
  } catch (e) { console.error('poll:', e.message); return; } finally { polling = false; }
  send('sessions', sessions);
  const r = State.notifications(memo, sessions, visible, !!win?.isFocused() && win.isVisible());
  memo = r.memo;
  if (settings.notifications && Notification.isSupported()) for (const m of r.notifications) {
    const n = new Notification({ title: m.title, body: m.body, icon: ICON });
    n.on('click', () => jump(m.id));
    n.show();
  }
}
setInterval(poll, 2000);

conn.on('status', (st, info) => {
  send('status', st, info);
  if (st === 'connected') { poll(); checkUpdate(); } else for (const [id] of channels) { channels.delete(id); send('channel-closed', id); }
});

// ── Updates (GitHub Releases, Windows installer only) ───────────────

let lastCheck = 0;
// Returns what the settings view shows: 'current', 'ready' or an error text.
async function checkUpdate(now = false) {
  if (!app.isPackaged || process.platform !== 'win32') return { result: 'Only in the installed Windows app' };
  if (ready) return { result: 'ready', version: readyVersion };
  if (!now && Date.now() - lastCheck < 5 * 60 * 1000) return null;
  lastCheck = Date.now();
  try {
    const info = await updater.check(app.getVersion());
    if (!info) return { result: 'current' };
    ready = await updater.download(info, app.getPath('temp'));
    readyVersion = info.version;
    send('update', { version: info.version });
    return { result: 'ready', version: info.version };
  } catch (e) { console.error('update:', e.message); return { result: `Error: ${e.message}` }; }
}
setInterval(checkUpdate, 30 * 60 * 1000);

// ── Sessions ────────────────────────────────────────────────────────

const sessionById = id => { const s = sessions.find(x => x.id === id); if (!s) throw new Error('Unknown session'); return s; };

// New tmux session running claude in a login shell (so PATH from the profile applies).
async function createSession(cwd, resume, name) {
  const tail = name && String(name).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const id = `${tail || 'sd'}-${Date.now().toString(36).slice(-5)}`;
  const cmd = settings.claudeCommand + (resume ? ` --resume ${q(resume)}` : '');
  await conn.exec(`tmux new-session -d -s ${q(id)} -c ${rq(cwd)} ${q(`exec "\${SHELL:-/bin/sh}" -lc ${q(cmd)}`)}`);
  poll();
  return { id };
}

ipcMain.handle('open', async (_e, id, cols, rows) => {
  const s = sessionById(id);
  if (channels.has(id)) { channels.get(id).setWindow(rows, cols, 0, 0); return; }
  const ch = await conn.shell(s.tmux, cols, rows);
  channels.set(id, ch);
  ch.on('data', d => send('data', id, d.toString('utf8')));
  ch.on('close', () => { if (channels.get(id) === ch) { channels.delete(id); send('channel-closed', id); } });
});
ipcMain.on('write', (_e, id, d) => channels.get(id)?.write(d));
ipcMain.on('resize', (_e, id, cols, rows) => channels.get(id)?.setWindow(rows, cols, 0, 0));
ipcMain.on('visible', (_e, ids) => { visible = new Set(ids); });
ipcMain.handle('keys', (_e, tmux, args) => conn.keys(tmux, args));
// Question card: move the cursor in Claude's menu to a row. The screen is read right before,
// because the polled state can be seconds old. One arrow at a time, Claude drops some otherwise.
ipcMain.handle('menu-go', async (_e, tmux, target) => {
  const m = State.readMenu(await conn.exec(`tmux capture-pane -p -t ${q(tmux)}`));
  const i = m ? m.rows.findIndex(r => (target === 'next' ? r.next : r.n === target)) : -1;
  if (i < 0 || m.cursor < 0) throw new Error('Menu not found');
  for (let k = 0; k < Math.abs(i - m.cursor); k++) await conn.keys(tmux, [i > m.cursor ? 'Down' : 'Up']);
});
// Project folders: every visible directory directly below projectsRoot.
ipcMain.handle('projects', async () => {
  const out = await conn.exec(`find ${rq(settings.projectsRoot || '~')} -mindepth 1 -maxdepth 1 -type d -not -name '.*' 2>/dev/null | sort`).catch(e => e.message);
  return out.split('\n').filter(l => l.startsWith('/'));
});
ipcMain.handle('create', (_e, cwd, resume, name) => createSession(String(cwd), resume, name));
ipcMain.handle('end', async (_e, id) => {
  channels.get(id)?.close();
  await conn.exec(`tmux kill-session -t ${q(sessionById(id).tmux)}`);
  poll();
});
// Ctrl+V: an image on the clipboard goes to the server as a file and its path into the prompt, otherwise text.
// Since Electron 44 the clipboard is async (W3C style), readImage is gone.
ipcMain.handle('paste', async (_e, id) => {
  for (const item of await clipboard.read()) {
    const type = item.types.filter(t => t.startsWith('image/'))[0];
    if (!type) continue;
    const blob = await item.getType(type);
    const p = await conn.upload(`${Date.now().toString(36)}-clipboard.${type.split('/')[1].replace('jpeg', 'jpg')}`, Buffer.from(await blob.arrayBuffer()));
    channels.get(id)?.write(`${p} `);
    return { image: true };
  }
  return { text: await clipboard.readText() };
});
// Drag and drop: the file goes to the server, the path into the prompt.
ipcMain.handle('drop', (_e, name, data) => {
  const safe = String(name).replace(/[^\w.-]+/g, '_').slice(-80) || 'file';
  return conn.upload(`${Date.now().toString(36)}-${safe}`, Buffer.from(data));
});
// Image paths from the terminal: fetch from the server as a data URL for the preview.
const IMAGE_TYPE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
ipcMain.handle('image', async (_e, p) => {
  const type = IMAGE_TYPE[String(p).split('.').pop().toLowerCase()];
  if (!type || !String(p).startsWith('/')) throw new Error('not an image');
  return `data:${type};base64,${(await conn.read(p, 30e6)).toString('base64')}`;
});
// Code paths from the terminal: absolute, relative to the session folder or to projectsRoot.
ipcMain.handle('file', async (_e, p, id) => {
  p = String(p);
  const cwd = sessions.find(x => x.id === id)?.cwd;
  const root = settings.projectsRoot || '~';
  const places = p.startsWith('/') ? [p] : [cwd && path.posix.join(cwd, p), path.posix.join(root, p)].filter(Boolean);
  for (const place of places) {
    let buf;
    try { buf = await conn.read(place); } catch (e) { if (e.code === 2) continue; throw e; }
    if (buf.includes(0)) throw new Error('not a text file');
    const text = buf.toString('utf8');
    const lang = place.split('.').pop().toLowerCase();
    // hljs runs synchronously in the main process and would stall the terminals on huge files.
    const html = hljs.getLanguage(lang) && buf.length < 200e3
      ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
      : text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    return { path: place, html, lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0) };
  }
  throw new Error('not found');
});
ipcMain.handle('diff', (_e, id) => conn.diff(sessionById(id).cwd));
// Ctrl+F: Claude runs full screen, tmux has little scrollback. So read the session transcript;
// lines from the screen help to pick the right file when several sessions share a folder.
const screen = s => conn.exec(`tmux capture-pane -p -J -t ${q(s.tmux)}`).catch(() => '');
async function transcript(id, mode = 'text') {
  const s = sessionById(id);
  const samples = (await screen(s)).split('\n').map(l => l.trim()).filter(l => /^[\w .,:()-]{30,}$/.test(l)).slice(-4);
  return conn.exec(`python3 -c ${q(TRANSCRIPT)} ${q(s.cwd)} ${q(Buffer.from(samples.join('\n')).toString('base64'))} ${q(mode)}`);
}
ipcMain.handle('history-text', (_e, id) => transcript(id).catch(() => screen(sessionById(id))));
ipcMain.on('copy', (_e, t) => clipboard.writeText(t).catch(e => console.error('copy:', e.message)));
ipcMain.on('overlay', (_e, dataUrl, count) => {
  if (!win) return;
  if (process.platform === 'win32') win.setOverlayIcon(dataUrl ? nativeImage.createFromDataURL(dataUrl) : null, count ? `${count} waiting` : '');
  tray?.setToolTip(count ? `SessionDeck, ${count} waiting` : 'SessionDeck');
});
ipcMain.on('restart', () => {
  if (!ready) return;
  updater.install(ready);
  quitting = true;
  app.quit();
});
ipcMain.handle('check-update', () => checkUpdate(true));
ipcMain.handle('settings', () => ({
  ...settings, version: app.getVersion(), packaged: app.isPackaged, platform: process.platform,
  autostart: app.isPackaged && app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin,
}));
ipcMain.handle('setting', (_e, name, value) => {
  if (name === 'autostart') { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!value, args: ['--hidden'] }); return; }
  if (name === 'connection' || !(name in DEFAULTS) || typeof value !== typeof DEFAULTS[name]) return;
  if (Array.isArray(DEFAULTS[name]) && !(Array.isArray(value) && value.every(t => typeof t === 'string'))) return;
  settings[name] = value;
  saveSettings();
});
// Connection form in Settings: store and reconnect. hostKey is only ever kept or cleared, never typed in.
ipcMain.handle('connect', (_e, c) => {
  const old = settings.connection;
  const next = {
    host: String(c.host || '').trim(), port: Number(c.port) || 22, username: String(c.username || '').trim(),
    privateKeyPath: String(c.privateKeyPath || '').trim(), agent: String(c.agent || '').trim(),
  };
  const same = next.host === old.host && next.port === old.port;
  settings.connection = { ...next, hostKey: c.resetHostKey || !same ? '' : old.hostKey };
  saveSettings();
  conn.restart(settings.connection);
});
ipcMain.handle('status', () => [conn.status, conn.info]);

// Feature modules in main/<name>.js; their channels are "<name>:<what>" (see preload.js).
const context = { ipcMain, conn, q, send, app, session, fs, path, sessionById, transcript, createSession, settings: () => settings };
for (const m of ['voice', 'live', 'search', 'timeline']) require(`./main/${m}`)(context);

// ── Start ───────────────────────────────────────────────────────────

app.on('web-contents-created', (_e, wc) => {
  // Webviews: no Node, allowed addresses only; links elsewhere open in the browser.
  wc.on('will-attach-webview', (ev, prefs, params) => {
    delete prefs.preload;
    prefs.nodeIntegration = false; prefs.contextIsolation = true; prefs.sandbox = true;
    if (!(params.partition === 'persist:web' && isWeb(params.src)) && !(params.partition === 'persist:claude' && params.src.startsWith(PREVIEW[0]))
      && !(LIVE.test(params.partition) && httpPage(params.src))) ev.preventDefault();
  });
  if (wc.getType() !== 'webview') return;
  wc.setWindowOpenHandler(({ url }) => { if (httpPage(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (ev, url) => { if (!allowed(wc, url)) { ev.preventDefault(); if (httpPage(url)) shell.openExternal(url); } });
  // Ctrl+digit, Ctrl+Tab, Ctrl+, and Ctrl+K also work while focus is inside a page.
  wc.on('before-input-event', (ev, i) => {
    if (i.type !== 'keyDown' || !i.control || i.alt) return;
    if (/^Digit\d$/.test(i.code) || i.key === 'Tab' || i.key === ',' || i.code === 'KeyK') {
      ev.preventDefault();
      send('shortcut', { code: i.code, key: i.key, shiftKey: i.shift });
    }
  });
});

app.whenReady().then(() => {
  loadSettings();
  conn.settings = settings.connection;
  // claude.ai sits behind a bot check: appear as plain Chrome.
  const ps = session.fromPartition('persist:claude');
  ps.setUserAgent(ps.getUserAgent().replace(/ (Electron|sessiondeck[\w-]*)\/\S+/gi, ''));
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient('sessiondeck');
    // Autostart only on the very first start, afterwards the settings view decides.
    if (!settings.autostartSet) {
      app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
      settings.autostartSet = true;
      saveSettings();
    }
  }
  createWindow();
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('SessionDeck');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open', click: show },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', show);
  globalShortcut.register('Control+Alt+C', show);
  conn.start();
});

app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
