const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Connection, q, rq, sshOptions, fingerprint } = require('../connection');
const { execSync } = require('child_process');

test('q quotes anything for a POSIX shell', () => {
  assert.strictEqual(q('plain'), "'plain'");
  assert.strictEqual(q("it's"), "'it'\\''s'");
  assert.strictEqual(q('$(rm -rf /)'), "'$(rm -rf /)'");
});

test('rq expands ~ on the server, quotes the rest', () => {
  assert.strictEqual(rq('~'), '"$HOME"');
  assert.strictEqual(rq('~/code'), `"$HOME"/'code'`);
  assert.strictEqual(rq('/srv/a b'), "'/srv/a b'");
});

test('sshOptions needs host, user and a key or an agent', () => {
  assert.throws(() => sshOptions({}), /No server configured/);
  assert.throws(() => sshOptions({ host: 'h', username: 'u' }), /private key file or enable ssh-agent/);
  assert.throws(() => sshOptions({ host: 'h', username: 'u', privateKeyPath: '/nope/key' }), /Cannot read key/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'key-'));
  fs.writeFileSync(path.join(dir, 'id'), 'KEY');
  const o = sshOptions({ host: 'h', port: '2222', username: 'u', privateKeyPath: path.join(dir, 'id') });
  assert.deepStrictEqual([o.host, o.port, o.username, o.privateKey.toString()], ['h', 2222, 'u', 'KEY']);
  assert.strictEqual(sshOptions({ host: 'h', username: 'u', agent: '/tmp/agent.sock' }).agent, '/tmp/agent.sock');
  fs.rmSync(dir, { recursive: true });
});

test('fingerprint looks like OpenSSH SHA256', () => {
  assert.match(fingerprint(Buffer.from('key')), /^SHA256:[A-Za-z0-9+/]{43}$/);
});

test('diffFiles shows only the given files, with absolute names, across repos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-diff-'));
  const sh = c => execSync(c, { cwd: dir, shell: '/bin/bash' });
  sh('git init -q a && git init -q b && echo 1 > a/mine.txt && echo 1 > a/other.txt && echo 1 > b/far.txt'
    + ' && git -C a add . && git -C b add . && git -C a -c user.name=t -c user.email=t@t commit -qm x && git -C b -c user.name=t -c user.email=t@t commit -qm x'
    + ' && echo 2 > a/mine.txt && echo 2 > a/other.txt && echo 2 > b/far.txt && echo new > a/fresh.txt && echo x > a/untouched-new.txt');
  const exec = (cmd, stdin) => execSync(cmd, { input: stdin, shell: '/bin/bash' }).toString();
  const files = ['mine.txt', 'fresh.txt', 'gone/nope.txt'].map(f => path.join(dir, 'a', f)).concat(path.join(dir, 'b', 'far.txt'));
  const r = await Connection.prototype.diffFiles.call({ exec }, files);
  const names = r.diff.split('\n').filter(z => z.startsWith('+++ ')).map(z => z.slice(6));
  const real = p => fs.realpathSync(p);
  assert.deepStrictEqual(names.map(real), [real(files[0]), real(files[3])]);
  assert.deepStrictEqual(r.fresh, [files[1]]);
  assert.ok(!r.diff.includes('other.txt'));
});
