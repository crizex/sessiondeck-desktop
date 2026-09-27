const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { q, rq, sshOptions, fingerprint } = require('../connection');

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
