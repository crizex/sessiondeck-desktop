// Limit pause (server/limit.py) and messages between sessions (server/transcript.py messages).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const State = require('../state');

const ROOT = path.join(__dirname, '..');
const py = (code, input = '') => JSON.parse(execFileSync('python3', ['-c', `import json, sys; sys.path.insert(0, "server"); ${code}`], { cwd: ROOT, input }).toString());

test('limitPercent: 1 to 100, anything else is off', () => {
  assert.deepStrictEqual([90, '85', 0, '', 'x', 120, -5, 99.6].map(State.limitPercent), [90, 85, 0, 0, 0, 0, 0, 100]);
});

test('window: a reset in the past counts as 0 %, the status line may be older than the reset', () => {
  const r = py('import limit; print(json.dumps([limit.window({"used_percentage": 93.4, "resets_at": 100}, 50_000), limit.window({"used_percentage": 93.4, "resets_at": 100}, 200_000), limit.window(None, 0)]))');
  assert.deepStrictEqual(r, [[93, 100000], [0, 100000], [null, null]]);
});

test('tick: pause once per window, resume after the reset when usage is below the limit', () => {
  const r = py(`import limit
u = lambda p: {"pct": p}
print(json.dumps([
  limit.tick(90, ["a"], {}, u(91), 0)[1],              # over the limit, something works: pause
  limit.tick(90, [], {}, u(95), 0)[1],                 # nothing works: nothing to pause
  limit.tick(90, ["a"], {}, u(None), 0)[1],            # no status line: never pause
  limit.tick(90, ["a"], {"until": 10}, u(95), 5)[1],   # paused, window not over
  limit.tick(90, ["a"], {"until": 10}, u(95), 20)[1],  # over, but still at the limit
  limit.tick(90, ["a"], {"until": 10, "paused": ["a"]}, u(0), 20),
]))`);
  assert.deepStrictEqual(r, ['pause', null, null, null, null, [{}, 'resume']]);
});

test('resume sends the paused sessions on and keeps the window, so no second pause in it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-')), bin = path.join(home, 'bin'), log = path.join(home, 'tmux.log');
  fs.mkdirSync(path.join(home, '.claude')); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "$@" >> ${log}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(home, '.claude', 'sessiondeck-limit.json'), JSON.stringify({ paused: ['api', 'web'], until: 123 }));
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
  const out = execFileSync('python3', ['server/limit.py', 'resume'], { cwd: ROOT, env }).toString().trim();
  assert.strictEqual(out, '2');
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.deepStrictEqual(calls.map(c => c.split(' ').slice(0, 4).join(' ')), ['send-keys -t api -l', 'send-keys -t api Enter', 'send-keys -t web -l', 'send-keys -t web Enter']);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(home, '.claude', 'sessiondeck-limit.json'), 'utf8')), { paused: [], until: 123 });
  const st = JSON.parse(execFileSync('python3', ['server/limit.py', 'status'], { cwd: ROOT, env }).toString());
  assert.deepStrictEqual(st, { pct: null, reset: null, week: null, weekReset: null, paused: [], until: 123 });
});

test('messages: incoming once (attachment and user text), outgoing from SendMessage, replies show the name', () => {
  const msg = '<cross-session-message from="/tmp/s1.sock" from-name="api">tests are green</cross-session-message>';
  const lines = [
    { type: 'attachment', timestamp: 't1', attachment: { prompt: msg } },
    { type: 'user', timestamp: 't1', message: { content: msg } },
    { type: 'assistant', timestamp: 't2', message: { content: [{ type: 'tool_use', name: 'SendMessage', input: { to: '/tmp/s1.sock', message: 'thanks' } }] } },
    { type: 'assistant', isSidechain: true, timestamp: 't3', message: { content: [{ type: 'tool_use', name: 'SendMessage', input: { to: 'x', message: 'from a subagent' } }] } },
  ].map(l => JSON.stringify(l));
  const r = py('exec(open("server/transcript.py").read().replace("\\nmain()", "")); print(json.dumps(messages(json.loads(sys.stdin.read()))))', JSON.stringify(lines));
  assert.deepStrictEqual(r, [
    { time: 't1', dir: 'in', who: 'api', text: 'tests are green' },
    { time: 't2', dir: 'out', who: 'api', text: 'thanks' },
  ]);
});
