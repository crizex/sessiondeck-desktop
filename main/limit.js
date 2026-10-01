// 5-hour limit and limit pause, see server/limit.py. Usage comes from the status line (server/statusline.sh).
const State = require('../state');

module.exports = context => {
  const { ipcMain, conn, q, fs, path, send, settings, sessionsNow } = context;
  const LIMIT = fs.readFileSync(path.join(__dirname, '..', 'server', 'limit.py'), 'utf8');
  const run = (...a) => conn.exec(`python3 -c ${q(LIMIT)} ${a.map(x => q(String(x))).join(' ')}`);
  const working = () => sessionsNow().filter(s => s.state === 'working').map(s => s.tmux);
  let last = {};
  // The queue sends nothing to paused sessions, it would wake them up again.
  context.limitPaused = () => new Set(last.paused || []);
  const status = async () => {
    last = JSON.parse(await run('status'));
    send('limit:changed', last);
    return last;
  };

  ipcMain.handle('limit:status', () => (conn.status === 'connected' ? status() : last));
  ipcMain.handle('limit:pause', async () => { const n = Number(await run('pause', ...working())); await status(); return n; });
  ipcMain.handle('limit:resume', async () => { const n = Number(await run('resume')); await status(); return n; });

  setInterval(async () => {
    if (conn.status !== 'connected') return;
    try {
      const at = State.limitPercent(settings().limitPause);
      if (at) await run('tick', at, ...working());
      await status();
    } catch (e) { console.error('limit:', e.message); }
  }, 60000);
};
