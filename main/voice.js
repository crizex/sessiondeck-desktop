// Optional voice input (setting "voice", off by default). The recording goes over SSH (stdin) to the
// Whisper service on the server (server/voice/). A small python snippet there talks to the Unix socket
// and prints its JSON answer, so no port has to be opened.
const CLIENT = `import socket,sys
s=socket.socket(socket.AF_UNIX);s.settimeout(180);s.connect('/run/sessiondeck-voice/sock')
s.sendall(sys.stdin.buffer.read());s.shutdown(socket.SHUT_WR)
sys.stdout.buffer.write(b''.join(iter(lambda:s.recv(65536),b'')))`;
const MAX = 25 * 1024 * 1024;

// Only the main window (file://) gets the microphone, and only while voice input is enabled.
const audioOnly = (wc, types) => wc?.getType() === 'window' && wc.getURL().startsWith('file://') && (!types || types.every(t => t === 'audio'));

module.exports = ({ ipcMain, conn, q, app, session, settings }) => {
  app.whenReady().then(() => {
    const s = session.defaultSession;
    const ok = (wc, types) => !!settings().voice && audioOnly(wc, types);
    s.setPermissionRequestHandler((wc, perm, cb, details) => cb(perm !== 'media' || ok(wc, details.mediaTypes)));
    s.setPermissionCheckHandler((wc, perm, _origin, details) => perm !== 'media' || ok(wc, details.mediaType && [details.mediaType]));
  });

  ipcMain.handle('voice:recognize', async (_e, data, from = 0, fast = false) => {
    if (!settings().voice) throw new Error('Voice input is off (Settings)');
    const buf = Buffer.from(data);
    if (!buf.length || buf.length > MAX) throw new Error('Recording empty or too large');
    const head = Buffer.from(`${JSON.stringify({ from: Math.max(0, +from || 0), fast: !!fast })}\n`);
    let out;
    try {
      out = await conn.exec(`python3 -c ${q(CLIENT)}`, Buffer.concat([head, buf]));
    } catch (e) {
      throw new Error(/FileNotFound|ConnectionRefused/.test(e.message) ? 'Voice service is not running on the server' : `Voice service: ${e.message}`);
    }
    let r;
    try { r = JSON.parse(out); } catch { throw new Error('Voice service: unreadable answer'); }
    if (r.error) throw new Error(r.error);
    return r;
  });
};
