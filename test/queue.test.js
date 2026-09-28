// main/queue.js with a mocked clock: a pool prompt goes to a matching session after a calm minute,
// or after two minutes to a newly started one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function setup(t, sessions) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-'));
  const handler = {}, typed = [], sent = [], started = [];
  require('../main/queue')({
    ipcMain: { handle: (k, f) => { handler[k] = f; } },
    conn: { status: 'connected', keys: async (tmux, a) => { typed.push([tmux, ...a]); } },
    app: { getPath: () => dir }, fs, path,
    send: (k, x) => sent.push([k, x]),
    sessionsNow: () => sessions,
    createSession: async (cwd, resume, name) => { started.push([cwd, name]); return { id: 'new1' }; },
    settings: () => ({ projectsRoot: '~/projects' }),
  });
  // one poll = 500 + 5 x 300 ms = 2 s
  const wait = async sec => {
    for (let i = 0; i < sec / 2; i++) {
      t.mock.timers.tick(500);
      for (let k = 0; k < 5; k++) { await new Promise(setImmediate); t.mock.timers.tick(300); }
    }
  };
  t.after(() => fs.rmSync(dir, { recursive: true }));
  return { handler, typed, sent, started, wait, dir };
}

test('queue: a pool prompt goes to the free session in its folder, not to the other one', async t => {
  const q = setup(t, [{ id: 'other', tmux: 'to', cwd: '/b', state: 'waiting' }, { id: 'here', tmux: 'th', cwd: '/a', state: 'idle' }]);
  await q.handler['queue:pool'](null, 'write\ntests', '/a');
  assert.deepStrictEqual(q.handler['queue:list']()['*'].texts, [{ text: 'write tests', folder: '/a' }]);
  await q.wait(70);
  assert.deepStrictEqual(q.typed, [['th', '-l', 'write tests'], ['th', 'Enter']]);
  assert.strictEqual(q.handler['queue:list']()['*'], undefined);
  assert.deepStrictEqual(q.sent.filter(([k]) => k === 'queue:handed'), [['queue:handed', { id: 'here', text: 'write tests' }]]);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(q.dir, 'queue.json'), 'utf8'))['*'], undefined);
});

test('queue: no matching session free, after 2 min a new one starts and gets the prompt', async t => {
  const sessions = [{ id: 'busy', tmux: 'tb', cwd: '/c', state: 'working' }];
  const q = setup(t, sessions);
  await q.handler['queue:pool'](null, 'check the deploy', '/c', true);
  await q.handler['queue:pool'](null, 'no new session', '/c', false);
  await q.wait(100);
  assert.deepStrictEqual(q.started, [], 'nothing started before 2 min');
  await q.wait(30);
  assert.deepStrictEqual(q.started, [['/c', 'c']]);
  const now = q.handler['queue:list']();
  assert.deepStrictEqual(now.new1.texts, ['check the deploy']);
  assert.deepStrictEqual(now['*'].texts.map(x => x.text), ['no new session']);
  // The new session shows up and is ready: the prompt goes out, only after the start delay
  sessions.push({ id: 'new1', tmux: 'tn', cwd: '/c', state: 'idle' });
  await q.wait(30);
  assert.deepStrictEqual(q.typed, [['tn', '-l', 'check the deploy'], ['tn', 'Enter']]);
  assert.strictEqual(q.started.length, 1);
});

test('queue: pool prompt without a folder starts in the projects folder, also with no session open', async t => {
  const q = setup(t, []);
  await q.handler['queue:pool'](null, 'tidy up', null, true);
  await q.wait(124);
  assert.deepStrictEqual(q.started, [['~/projects', 'projects']]);
  assert.deepStrictEqual(q.sent.filter(([k]) => k === 'queue:handed').map(([, x]) => x), [{ id: 'new1', text: 'tidy up', started: true }]);
});
