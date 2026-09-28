// Recap of a session (server/transcript.py recap): numbers from the transcript, commits and uncommitted files from git.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const recap = (cwd, lines) => JSON.parse(execFileSync('python3', ['-c',
  'import json, sys; sys.argv = ["x"]; exec(open("server/transcript.py").read().replace("\\nmain()", "")); a = json.loads(sys.stdin.read()); print(json.dumps(recap(a[0], a[1])))'],
{ cwd: path.join(__dirname, '..'), input: JSON.stringify([cwd, lines]) }).toString());

test('recap: rounds, files with +/-, tokens counted once, commits and uncommitted files from git', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-')));
  const me = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (a, env = {}) => execFileSync('git', ['-C', dir, ...a], { env: { ...process.env, ...me, ...env } }).toString();
  git(['init', '-q']);
  for (const f of ['a.js', 'b.js', 'other.js']) fs.writeFileSync(path.join(dir, f), 'old\n');
  git(['add', '.']);
  git(['commit', '-qm', 'before'], { GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' });
  const start = new Date(Date.now() - 60000).toISOString();
  fs.writeFileSync(path.join(dir, 'a.js'), 'new\ntwo\n');
  fs.writeFileSync(path.join(dir, 'other.js'), 'another session\n');
  git(['commit', '-qm', 'session commit', 'a.js']);
  git(['commit', '-qm', 'foreign commit', 'other.js']);
  fs.writeFileSync(path.join(dir, 'sed.js'), 'by sed\n');
  git(['add', 'sed.js']); git(['commit', '-qm', 'committed via Bash']);
  fs.writeFileSync(path.join(dir, 'sed.js'), 'again\n');
  git(['commit', '-qam', 'with output']);
  const hash = git(['rev-parse', '--short', 'HEAD']).trim();
  fs.writeFileSync(path.join(dir, 'b.js'), 'open\n');

  const user = (time, text) => JSON.stringify({ type: 'user', timestamp: time, message: { content: text } });
  const answer = (time, id, content, out) => JSON.stringify({ type: 'assistant', timestamp: time, message: { id, content, usage: { output_tokens: out } } });
  const edit = (p, o, n) => ({ type: 'tool_use', id: p, name: 'Edit', input: { file_path: path.join(dir, p), old_string: o, new_string: n } });
  const r = recap(dir, [
    user(start, 'do a'),
    answer(start, 'm1', [edit('a.js', 'old\n', 'new\ntwo\n')], 100),
    answer(start, 'm1', [{ type: 'text', text: 'a done' }], 100), // same message, second line
    answer(start, 'm3', [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: `cd ${dir} && git add sed.js && git commit -qm "committed via Bash"` } }], 1),
    JSON.stringify({ type: 'user', timestamp: start, message: { content: [{ type: 'tool_result', tool_use_id: 'c2', content: [{ type: 'text', text: `[master ${hash}] with output\n 1 file changed` }] }] } }),
    user(start, 'do b'),
    answer(new Date().toISOString(), 'm2', [edit('b.js', 'old\n', 'open\n'), { type: 'text', text: 'b done' }], 50),
  ]);
  assert.strictEqual(r.rounds, 2);
  assert.strictEqual(r.tools, 3);
  assert.strictEqual(r.output, 151);
  assert.strictEqual(r.answer, 'b done');
  assert.deepStrictEqual(r.files, [{ path: path.join(dir, 'a.js'), plus: 2, minus: 1 }, { path: path.join(dir, 'b.js'), plus: 1, minus: 1 }]);
  assert.deepStrictEqual(r.commits.map(c => [c.text, c.repo]).sort(), [['committed via Bash', path.basename(dir)], ['session commit', path.basename(dir)], ['with output', path.basename(dir)]]);
  assert.deepStrictEqual(r.uncommitted, [path.join(dir, 'b.js')]);
  assert.strictEqual(r.start, start);
  fs.rmSync(dir, { recursive: true });
});

test('recap: files outside git and an empty transcript', () => {
  const r = recap('/does/not/exist', [JSON.stringify({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'hello' } }),
    JSON.stringify({ type: 'assistant', message: { id: 'x', content: [{ type: 'tool_use', id: 'w', name: 'Write', input: { file_path: '/does/not/exist.txt', content: 'a\nb' } }] } })]);
  assert.deepStrictEqual(r.files, [{ path: '/does/not/exist.txt', plus: 2, minus: 0 }]);
  assert.deepStrictEqual([r.commits, r.uncommitted], [[], []]);
  assert.strictEqual(recap('/tmp', []).rounds, 0);
});
