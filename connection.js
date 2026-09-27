// One SSH connection to the server for everything: terminals (tmux attach), keys (tmux send-keys),
// commands (tmux, git, the python helpers) and SFTP for files.
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { Client } = require('ssh2');
const { backoff } = require('./state');

// POSIX single-quote escaping: safe for any content that ends up in a remote shell command.
const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
// Remote path for the shell: "~/x" expands to the remote home, everything else is quoted literally.
const rq = p => (/^~(\/|$)/.test(p) ? `"$HOME"${p.length > 2 ? '/' + q(p.slice(2)) : ''}` : q(p));
const expandHome = p => String(p || '').replace(/^~(?=$|[\\/])/, os.homedir());
const fingerprint = key => `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

// ssh-agent: Windows ships OpenSSH's agent as a named pipe, elsewhere SSH_AUTH_SOCK. "pageant" works too.
function agentPath(agent) {
  if (!agent) return undefined;
  if (agent !== 'auto') return agent;
  return process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : process.env.SSH_AUTH_SOCK;
}

// Options for ssh2 from the connection settings. Throws with a readable message when something is missing.
function sshOptions(c) {
  if (!c?.host || !c.username) throw new Error('No server configured');
  const opt = {
    host: c.host, port: Number(c.port) || 22, username: c.username,
    keepaliveInterval: 10000, keepaliveCountMax: 3, readyTimeout: 15000,
  };
  const agent = agentPath(c.agent);
  if (agent) opt.agent = agent;
  if (c.privateKeyPath) {
    try { opt.privateKey = fs.readFileSync(expandHome(c.privateKeyPath)); } catch (e) { throw new Error(`Cannot read key ${c.privateKeyPath}: ${e.code || e.message}`); }
  }
  if (!opt.agent && !opt.privateKey) throw new Error('Set a private key file or enable ssh-agent');
  return opt;
}

class Connection extends EventEmitter {
  // settings: the "connection" block from settings.json; onHostKey(fp) stores a first-seen host key.
  constructor(settings, onHostKey) {
    super();
    this.settings = settings;
    this.onHostKey = onHostKey;
    this.c = null;
    this.attempt = 0;
    this.status = 'disconnected';
    this.timer = null;
    this.gen = 0;
  }

  start() {
    const gen = ++this.gen;
    let opt;
    try { opt = sshOptions(this.settings); } catch (e) { return this._set('unconfigured', { error: e.message }); }
    this.opt = opt;
    let fatal = null, lastError = null;
    const c = new Client();
    // Trust on first use: remember the host key fingerprint, refuse to connect when it changes.
    opt.hostVerifier = key => {
      const fp = fingerprint(key);
      if (!this.settings.hostKey) { this.settings.hostKey = fp; this.onHostKey?.(fp); return true; }
      if (fp === this.settings.hostKey) return true;
      fatal = `Host key changed (${fp}). If that is expected, reset it in Settings.`;
      return false;
    };
    c.on('ready', () => {
      if (gen !== this.gen) return c.end();
      this.c = c; this.attempt = 0;
      this._set('connected', {});
    });
    c.on('error', e => { lastError = e.message; }); // close always follows, it goes on there
    c.on('close', () => {
      if (this.c === c) this.c = null;
      if (gen !== this.gen) return;
      if (fatal) return this._set('error', { error: fatal });
      const ms = backoff(this.attempt++);
      this._set('disconnected', { retryInMs: ms, error: lastError });
      this.timer = setTimeout(() => this.start(), ms);
    });
    c.connect(opt);
  }

  // New settings: drop the old connection and start over.
  restart(settings) {
    this.settings = settings;
    this.stop();
    this.attempt = 0;
    this.start();
  }

  stop() {
    this.gen++;
    clearTimeout(this.timer);
    this.c?.end();
    this.c = null;
    this._set('disconnected', {});
  }

  _set(status, info) {
    this.status = status;
    this.info = info;
    this.emit('status', status, info);
  }

  client() {
    if (!this.c) throw new Error('Not connected');
    return this.c;
  }

  // -u: tmux would draw ❯ and borders as underscores when the server has no UTF-8 locale.
  shell(tmuxId, cols, rows) {
    return new Promise((ok, no) => this.client().exec(`exec tmux -u attach-session -t ${q(tmuxId)}`,
      { pty: { term: 'xterm-256color', cols, rows } }, (err, ch) => (err ? no(err) : ok(ch))));
  }

  // Run a command, resolve with stdout+stderr; reject with that text on a non-zero exit. stdin optional.
  exec(cmd, stdin) {
    return new Promise((ok, no) => this.client().exec(cmd, (err, ch) => {
      if (err) return no(err);
      const out = [];
      ch.on('data', d => out.push(d)).stderr.on('data', d => out.push(d));
      ch.on('close', code => {
        const text = Buffer.concat(out).toString();
        if (code) { const e = new Error(text.trim() || `Exit ${code}`); e.code = code; no(e); } else ok(text);
      });
      ch.end(stdin);
    }));
  }

  keys(tmuxId, args) {
    return this.exec(`tmux send-keys -t ${q(tmuxId)} ${args.map(q).join(' ')}`);
  }

  // Working tree against HEAD, relative to the session folder, plus new files outside .gitignore.
  async diff(cwd) {
    const [diff, fresh] = await Promise.all([
      // ls-files below reports a missing repo; here only truncate before it goes over the network.
      this.exec(`git -C ${q(cwd)} -c core.quotePath=false diff HEAD --no-color --relative -- . 2>/dev/null | head -c 3000001`),
      this.exec(`git -C ${q(cwd)} -c core.quotePath=false ls-files --others --exclude-standard -- .`),
    ]);
    const list = fresh.split('\n').filter(Boolean);
    return { diff: diff.slice(0, 3e6), fresh: list.slice(0, 200), truncated: diff.length > 3e6 || list.length > 200 };
  }

  sftp() {
    return new Promise((ok, no) => this.client().sftp((err, s) => (err ? no(err) : ok(s))));
  }

  // Write a file to ~/.sessiondeck/uploads on the server (private to the SSH user), return its absolute path.
  // ponytail: uploads are never cleaned up, delete the folder now and then.
  async upload(name, buf) {
    const s = await this.sftp();
    try {
      const home = await new Promise((ok, no) => s.realpath('.', (err, p) => (err ? no(err) : ok(p))));
      const dir = `${home}/.sessiondeck/uploads`;
      for (const d of [`${home}/.sessiondeck`, dir]) await new Promise(ok => s.mkdir(d, { mode: 0o700 }, () => ok()));
      const path = `${dir}/${name}`;
      await new Promise((ok, no) => s.writeFile(path, buf, { mode: 0o600 }, err => (err ? no(err) : ok())));
      return path;
    } finally { s.end(); }
  }

  // Read a file from the server as a Buffer; do not even fetch it when larger than maxBytes.
  // SFTP paths without a leading slash are relative to the remote home, so "~/x" becomes "x".
  async read(path, maxBytes = 1e6) {
    path = String(path).replace(/^~\/?/, '') || '.';
    const s = await this.sftp();
    try {
      const st = await new Promise((ok, no) => s.stat(path, (err, x) => (err ? no(err) : ok(x))));
      if (st.size > maxBytes) throw new Error(`too large (${Math.round(st.size / 1e6)} MB)`);
      return await new Promise((ok, no) => s.readFile(path, (err, buf) => (err ? no(err) : ok(buf))));
    } finally { s.end(); }
  }
}

module.exports = { Connection, q, rq, sshOptions, fingerprint, expandHome };
