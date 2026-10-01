// Prompt queue per session and for the next free session: prompts go out as soon as a session is calm (State.due).
// Kept in a file next to the settings, so it survives a restart of the app.
const State = require('../state');

module.exports = ({ ipcMain, conn, app, fs, path, send, sessionsNow, createSession, settings, limitPaused = () => new Set() }) => {
  const FILE = path.join(app.getPath('userData'), 'queue.json');
  // queue: { id: { texts: [], since, at } }; under POOL the prompts for the next free session: texts = [{ text, folder, startAt }]
  const POOL = '*', START_MS = 120000;
  let queue = {}, memo = {};
  try { queue = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}

  const changed = () => {
    try { fs.writeFileSync(FILE, JSON.stringify(queue)); } catch {}
    send('queue:changed', queue);
  };
  const clean = text => String(text).trim().replace(/\s*\n\s*/g, ' '); // a newline would submit in Claude right away

  ipcMain.handle('queue:list', () => queue);
  // wait: a session that just started, Claude Code needs a few seconds until its prompt is ready
  ipcMain.handle('queue:add', (_e, id, text, wait = 0) => {
    text = clean(text);
    if (!text) return;
    const e = (queue[id] ??= { texts: [], since: Date.now() });
    e.texts.push(text);
    if (wait) e.at = Date.now() + Math.min(Number(wait) || 0, 60000);
    changed();
  });
  // folder: cwd the session must run in, or null for any; start: if none is free after START_MS, start a new session
  ipcMain.handle('queue:pool', (_e, text, folder, start) => {
    text = clean(text);
    if (!text) return;
    const x = { text, folder: folder ? String(folder) : null };
    if (start) x.startAt = Date.now() + START_MS;
    (queue[POOL] ??= { texts: [], since: Date.now() }).texts.push(x);
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
    const starts = queue[POOL]?.texts.filter(x => Date.now() >= x.startAt) || [];
    if (busy || conn.status !== 'connected' || !Object.keys(queue).length) return;
    busy = true;
    try {
      // Pool prompts no session took in time: new session in the target folder, the prompt moves to its queue
      for (const x of starts) {
        const dir = x.folder || settings().projectsRoot || '~';
        let r;
        try { r = await createSession(dir, null, path.posix.basename(dir)); }
        catch (e) { console.error('queue: start', e.message); x.startAt = Date.now() + 60000; continue; }
        const i = queue[POOL]?.texts.indexOf(x) ?? -1;
        if (i >= 0) queue[POOL].texts.splice(i, 1);
        if (!queue[POOL]?.texts.length) delete queue[POOL];
        queue[r.id] = { texts: [x.text], since: Date.now(), at: Date.now() + 15000 }; // Claude Code needs a moment
        send('queue:handed', { id: r.id, text: x.text, started: true });
        changed();
      }
      if (!sessions.length) return;
      // Drop queues of sessions that ended; a session that just started may be missing for a moment.
      let gone = false;
      for (const [id, e] of Object.entries(queue)) {
        if (id !== POOL && !sessions.some(s => s.id === id) && Date.now() - e.since > 120000) { delete queue[id]; gone = true; }
      }
      if (gone) changed();
      const texts = Object.fromEntries(Object.entries(queue).filter(([id, e]) => id !== POOL && !(Date.now() < e.at)).map(([id, e]) => [id, e.texts]));
      const r = State.due(memo, sessions, texts, limitPaused(), Date.now(), queue[POOL]?.texts || []);
      memo = r.memo;
      for (const x of r.send) {
        try {
          await conn.keys(x.tmux, ['-l', x.text]);
          await new Promise(ok => setTimeout(ok, 300));
          await conn.keys(x.tmux, ['Enter']);
        } catch (e) { console.error('queue:', e.message); continue; } // stays queued, next try after the lock
        const key = x.pool ? POOL : x.id;
        const i = x.pool ? queue[POOL]?.texts.indexOf(x.pool) ?? -1 : 0;
        if (x.pool && i < 0) continue; // removed in the meantime
        if (x.pool) { queue[POOL].texts.splice(i, 1); send('queue:handed', { id: x.id, text: x.text }); }
        else queue[x.id].texts.shift();
        if (!queue[key].texts.length) delete queue[key];
        changed();
      }
    } finally { busy = false; }
  }, 2000);
};
