// Prompt queue per session: prompts go out one by one as soon as the session is calm (State.due).
// Kept in a file next to the settings, so it survives a restart of the app.
const State = require('../state');

module.exports = ({ ipcMain, conn, app, fs, path, send, sessionsNow }) => {
  const FILE = path.join(app.getPath('userData'), 'queue.json');
  let queue = {}, memo = {}; // queue: { id: { texts: [], since } }
  try { queue = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}

  const changed = () => {
    try { fs.writeFileSync(FILE, JSON.stringify(queue)); } catch {}
    send('queue:changed', queue);
  };

  ipcMain.handle('queue:list', () => queue);
  ipcMain.handle('queue:add', (_e, id, text) => {
    text = String(text).trim().replace(/\s*\n\s*/g, ' '); // a newline would submit in Claude right away
    if (!text) return;
    (queue[id] ??= { texts: [], since: Date.now() }).texts.push(text);
    changed();
  });
  ipcMain.handle('queue:remove', (_e, id, i) => {
    queue[id]?.texts.splice(i, 1);
    if (!queue[id]?.texts.length) delete queue[id];
    changed();
  });

  let busy = false;
  setInterval(async () => {
    const sessions = sessionsNow();
    if (busy || conn.status !== 'connected' || !sessions.length || !Object.keys(queue).length) return;
    busy = true;
    try {
      // Drop queues of sessions that ended; a session that just started may be missing for a moment.
      let gone = false;
      for (const [id, e] of Object.entries(queue)) {
        if (!sessions.some(s => s.id === id) && Date.now() - e.since > 120000) { delete queue[id]; gone = true; }
      }
      if (gone) changed();
      const texts = Object.fromEntries(Object.entries(queue).map(([id, e]) => [id, e.texts]));
      const r = State.due(memo, sessions, texts, new Set(), Date.now());
      memo = r.memo;
      for (const x of r.send) {
        try {
          await conn.keys(x.tmux, ['-l', x.text]);
          await new Promise(ok => setTimeout(ok, 300));
          await conn.keys(x.tmux, ['Enter']);
        } catch (e) { console.error('queue:', e.message); continue; } // stays queued, next try after the lock
        queue[x.id].texts.shift();
        if (!queue[x.id].texts.length) delete queue[x.id];
        changed();
      }
    } finally { busy = false; }
  }, 2000);
};
