// Ctrl+Shift+F: search across all Claude transcripts of the last 30 days (server/search_all.py).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

module.exports = ({ ipcMain, conn, q, fs, path, createSession }) => {
  const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'server', 'search_all.py'), 'utf8');
  const run = (...a) => conn.exec(`python3 -c ${q(SCRIPT)} ${a.map(q).join(' ')}`);

  ipcMain.handle('search:all', async (_e, term) =>
    JSON.parse(await run('search', Buffer.from(String(term)).toString('base64'))));

  // Read only: one conversation as text, without starting a session.
  ipcMain.handle('search:history', (_e, sid) => {
    if (!UUID.test(sid)) throw new Error('invalid conversation id');
    return run('history', sid);
  });

  // Continue an old conversation in a new session (claude --resume in the same folder).
  ipcMain.handle('search:resume', (_e, cwd, sid, name) => {
    if (!UUID.test(sid)) throw new Error('invalid conversation id');
    return createSession(cwd, sid, name);
  });
};
