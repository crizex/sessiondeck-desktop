// server/search_all.py: self test of the pure logic and one run against made-up transcripts.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'server', 'search_all.py');
let python = true;
try { execFileSync('python3', ['--version']); } catch { python = false; }

test('search_all.py self test', { skip: !python && 'no python3' }, () => {
  assert.strictEqual(execFileSync('python3', [SCRIPT, '--selftest']).toString().trim(), 'ok');
});

test('search_all.py finds prompts and answers, not tool results', { skip: !python && 'no python3' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'search-'));
  const folder = path.join(home, '.claude', 'projects', '-srv-demo');
  fs.mkdirSync(folder, { recursive: true });
  const j = o => JSON.stringify(o);
  const id = '11111111-2222-3333-4444-555555555555';
  fs.writeFileSync(path.join(folder, `${id}.jsonl`), [
    j({ type: 'user', cwd: '/srv/demo', message: { content: 'Build the handover for Brimstone' } }),
    j({ type: 'assistant', message: { content: [{ type: 'text', text: 'On it, BRIMSTONE is coming.' }] } }),
    j({ type: 'user', message: { content: [{ type: 'tool_result', content: 'only in the tool: butterfly' }] } }),
  ].join('\n'));
  const search = b => JSON.parse(execFileSync('python3', [SCRIPT, 'search', Buffer.from(b).toString('base64')], { env: { ...process.env, HOME: home } }));
  const r = search('brimstone');
  assert.strictEqual(r.conversations.length, 1);
  const g = r.conversations[0];
  assert.deepStrictEqual([g.id, g.cwd, g.title], [id, '/srv/demo', 'Build the handover for Brimstone']);
  assert.deepStrictEqual(g.excerpts.map(a => a.who), ['you', 'claude']);
  assert.strictEqual(search('handover').conversations.length, 1);
  assert.strictEqual(search('butterfly').conversations.length, 0);
  fs.rmSync(home, { recursive: true });
});
