const { contextBridge, ipcRenderer } = require('electron');

const on = channel => fn => ipcRenderer.on(channel, (_e, ...a) => fn(...a));
const MODULE = /^(voice|live|search|timeline|queue|recap):[\w-]+$/;
const allowed = c => { if (!MODULE.test(c)) throw new Error(`Channel ${c} not allowed`); return c; };

contextBridge.exposeInMainWorld('deck', {
  mac: process.platform === 'darwin',
  open: (id, cols, rows) => ipcRenderer.invoke('open', id, cols, rows),
  write: (id, d) => ipcRenderer.send('write', id, d),
  resize: (id, cols, rows) => ipcRenderer.send('resize', id, cols, rows),
  visible: ids => ipcRenderer.send('visible', ids),
  keys: (tmux, args) => ipcRenderer.invoke('keys', tmux, args),
  menuGo: (tmux, target) => ipcRenderer.invoke('menu-go', tmux, target),
  projects: () => ipcRenderer.invoke('projects'),
  create: (cwd, resume, name) => ipcRenderer.invoke('create', cwd, resume, name),
  end: id => ipcRenderer.invoke('end', id),
  paste: id => ipcRenderer.invoke('paste', id),
  drop: (name, data) => ipcRenderer.invoke('drop', name, data),
  image: (p, id) => ipcRenderer.invoke('image', p, id),
  file: (p, id) => ipcRenderer.invoke('file', p, id),
  diff: id => ipcRenderer.invoke('diff', id),
  historyText: id => ipcRenderer.invoke('history-text', id),
  copy: t => ipcRenderer.send('copy', t),
  overlay: (dataUrl, count) => ipcRenderer.send('overlay', dataUrl, count),
  restart: () => ipcRenderer.send('restart'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  settings: () => ipcRenderer.invoke('settings'),
  setting: (name, value) => ipcRenderer.invoke('setting', name, value),
  connect: c => ipcRenderer.invoke('connect', c),
  status: () => ipcRenderer.invoke('status'),
  onSessions: on('sessions'),
  onData: on('data'),
  onChannelClosed: on('channel-closed'),
  onStatus: on('status'),
  onJump: on('jump'),
  onUpdate: on('update'),
  onShortcut: on('shortcut'),
  // Feature modules: call('live:open', ...) -> ipcMain.handle, on('live:changed', fn) <- send
  call: (channel, ...a) => ipcRenderer.invoke(allowed(channel), ...a),
  on: (channel, fn) => ipcRenderer.on(allowed(channel), (_e, ...a) => fn(...a)),
});
