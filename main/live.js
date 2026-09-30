// Live preview: show a dev server running on the server through a tunnel, watch the session folder.
const net = require('net');
const { Client } = require('ssh2');

// A small python relay on the server passes each connection over stdin/stdout to the dev server.
// That works even where sshd has AllowTcpForwarding off, because it only needs exec.
const RELAY = `
import os, socket, sys, threading
s = socket.create_connection(("127.0.0.1", int(sys.argv[1])))
def inbound():
    while d := os.read(0, 65536): s.sendall(d)
    s.shutdown(socket.SHUT_WR)
threading.Thread(target=inbound, daemon=True).start()
while d := s.recv(65536): sys.stdout.buffer.write(d); sys.stdout.buffer.flush()
`;

// Polling instead of inotify (often not installed). Reports the first changed path per round.
// End of stdin (channel closed) ends the script.
// ponytail: at most MAX files per round, in a huge tree the rest stays unwatched.
const WATCHER = `
import os, sys, threading, time
root, MAX = sys.argv[1], 20000
SKIP = {"node_modules", "dist", "build", "out", "coverage", "target", "venv", "__pycache__"}
threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()
def scan():
    st, stack = {}, [root]
    while stack and len(st) < MAX:
        try: it = os.scandir(stack.pop())
        except OSError: continue
        with it:
            for e in it:
                try:
                    if e.is_dir(follow_symlinks=False):
                        if e.name not in SKIP and not e.name.startswith("."): stack.append(e.path)
                    elif e.is_file(follow_symlinks=False): st[e.path] = e.stat().st_mtime_ns
                except OSError: pass
    return st
old = scan()
print("ready", len(old), "truncated" if len(old) >= MAX else "", flush=True)
while True:
    time.sleep(1)
    new = scan()
    if new != old:
        p = next(p for p in new.keys() | old.keys() if new.get(p) != old.get(p))
        print(os.path.relpath(p, root), flush=True)
    old = new
`;

// "5173", "localhost:3000" or a full address -> full address
function normalize(text) {
  let t = String(text).trim();
  if (/^\d{2,5}$/.test(t)) t = `localhost:${t}`;
  if (!/^https?:\/\//i.test(t)) t = (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(t) ? 'http://' : 'https://') + t;
  const u = new URL(t);
  if (!u.hostname) throw new Error('no address');
  return u.href;
}

// Port on the server when the address is local there, otherwise null (loaded directly)
function localPort(address) {
  const u = new URL(address);
  if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(u.hostname)) return null;
  return Number(u.port) || 80;
}

// Address suggestion from package.json: port from the dev script, otherwise the usual one of the tool
function suggest(pkgText) {
  let p;
  try { p = JSON.parse(pkgText); } catch { return ''; }
  const s = p?.scripts || {};
  const dev = s.dev || s.start || s.serve || '';
  const port = /(?:--port[= ]|-p\s*|PORT=)(\d{2,5})\b/.exec(dev)?.[1]
    || (/\bvite\b/.test(dev) ? 5173 : /\bnext\b/.test(dev) ? 3000 : /\bastro\b/.test(dev) ? 4321 : null);
  return port ? `http://localhost:${port}/` : '';
}

module.exports = ({ ipcMain, conn, q, send, sessionById, transcript, fs, path }) => {
  // Did the session last write an HTML file (a draft)? Then serve its folder and show that page.
  const DRAFT = fs.readFileSync(path.join(__dirname, '..', 'server', 'draft.py'), 'utf8');
  ipcMain.handle('live:draft', async (_e, id) => {
    const file = await transcript(id, 'html').then(JSON.parse).catch(() => null);
    return file ? JSON.parse(await conn.exec(`python3 -c ${q(DRAFT)} ${q(file)}`)) : null;
  });

  // Own SSH connection: sshd allows 10 channels per connection, the browser and terminals need many.
  let second = null;
  const connection = () => second ??= new Promise((ok, no) => {
    const c = new Client();
    c.on('ready', () => ok(c));
    c.on('error', e => { second = null; no(e); });
    c.on('close', () => { second = null; });
    c.connect(conn.opt);
  });
  const exec = cmd => connection().then(c => new Promise((ok, no) => c.exec(cmd, (e, ch) => (e ? no(e) : ok(ch)))));

  // Per server port one local server on 127.0.0.1:<random>, every connection its own exec channel.
  const tunnels = new Map();
  function tunnelTo(port) {
    if (!tunnels.has(port)) tunnels.set(port, new Promise((ok, no) => {
      const server = net.createServer(sock => {
        sock.on('error', () => {});
        exec(`exec python3 -c ${q(RELAY)} ${port}`).then(ch => {
          if (sock.destroyed) return ch.close();
          ch.stderr.resume();
          sock.pipe(ch).pipe(sock);
          ch.on('close', () => sock.destroy());
          sock.on('close', () => ch.close());
        }, () => sock.destroy());
      });
      server.on('error', e => { tunnels.delete(port); no(e); });
      server.listen(0, '127.0.0.1', () => ok(server.address().port));
    }));
    return tunnels.get(port);
  }

  ipcMain.handle('live:suggest', async (_e, id) =>
    suggest(await conn.exec(`head -c 200000 ${q(sessionById(id).cwd + '/package.json')} 2>/dev/null || true`)));

  ipcMain.handle('live:open', async (_e, text) => {
    const address = normalize(text), port = localPort(address);
    if (port == null) return { address, load: address };
    const u = new URL(address);
    return { address, load: `http://127.0.0.1:${await tunnelTo(port)}${u.pathname}${u.search}${u.hash}` };
  });

  // Only one watcher at a time, for the session in the panel.
  let watcher = null, round = 0;
  const stop = () => { round++; watcher?.end(); watcher = null; };
  ipcMain.handle('live:stop', stop);
  ipcMain.handle('live:watch', async (_e, id, root) => {
    stop();
    const nr = round, cwd = root || sessionById(id).cwd;
    const ch = await exec(`exec python3 -u -c ${q(WATCHER)} ${q(cwd)}`);
    if (nr !== round) return ch.end();
    watcher = ch;
    let timer = null, rest = '';
    ch.stderr.resume();
    ch.on('data', d => {
      const lines = (rest + d).split('\n');
      rest = lines.pop();
      for (const l of lines) {
        if (l.startsWith('ready ')) send('live:ready', id, parseInt(l.slice(6), 10), l.includes('truncated'));
        else if (l) { clearTimeout(timer); timer = setTimeout(() => send('live:changed', id, l), 700); }
      }
    });
    ch.on('close', () => { clearTimeout(timer); if (watcher === ch) watcher = null; });
  });
};
Object.assign(module.exports, { normalize, localPort, suggest });
