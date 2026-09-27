const test = require('node:test');
const assert = require('node:assert');
const z = require('../state');

const s = (id, state, extra = {}) => ({ id, name: id, state, question: null, changedAt: 0, ...extra });
const question = { text: 'Continue?', options: [{ n: 1, text: 'Yes', free: false }] };

test('color is stable and from the palette', () => {
  assert.strictEqual(z.color('api'), z.color('api'));
  assert.ok(z.PALETTE.includes(z.color('web')));
});

test('title: project folder instead of a generated name, a hand-picked name stays', () => {
  assert.strictEqual(z.title({ name: 'sd-k3x9a', cwd: '/srv/shop' }), 'shop');
  assert.strictEqual(z.title({ name: '0', cwd: '/srv/shop' }), 'shop');
  assert.strictEqual(z.title({ name: 'refactor', cwd: '/srv/shop' }), 'refactor');
  assert.strictEqual(z.title({ id: 'x1', name: '3', cwd: '' }), '3');
});

test('orderTabs keeps the order, appends new ones, drops ended ones', () => {
  assert.deepStrictEqual(z.orderTabs(['b', 'a', 'x'], [s('a'), s('b'), s('c')]), ['b', 'a', 'c']);
  assert.deepStrictEqual(z.orderTabs([], [s('a')]), ['a']);
});

test('nextWaiting goes round from the active one', () => {
  const l = [s('a', 'waiting'), s('b', 'working'), s('c', 'waiting'), s('d', 'idle')];
  assert.strictEqual(z.nextWaiting(l, 'a'), 'c');
  assert.strictEqual(z.nextWaiting(l, 'c'), 'a');
  assert.strictEqual(z.nextWaiting(l, 'b'), 'c');
  assert.strictEqual(z.nextWaiting([s('a', 'waiting')], 'a'), null);
  assert.strictEqual(z.nextWaiting(l, 'gone'), 'a');
});

test('notifications: working to waiting notifies once, only when stable', () => {
  let r = z.notifications({}, [s('a', 'working')], new Set(), false);
  assert.deepStrictEqual(r.notifications, []);
  r = z.notifications(r.memo, [s('a', 'waiting')], new Set(), false);
  assert.deepStrictEqual(r.notifications, [], 'a single blip does not notify yet');
  r = z.notifications(r.memo, [s('a', 'working')], new Set(), false);
  r = z.notifications(r.memo, [s('a', 'waiting')], new Set(), false);
  r = z.notifications(r.memo, [s('a', 'waiting')], new Set(), false);
  assert.deepStrictEqual(r.notifications, [], 'two polls are not stable yet');
  r = z.notifications(r.memo, [s('a', 'waiting')], new Set(), false);
  assert.deepStrictEqual(r.notifications, [{ id: 'a', title: 'a is done', body: 'Waiting for you.' }]);
  r = z.notifications(r.memo, [s('a', 'waiting')], new Set(), false);
  assert.deepStrictEqual(r.notifications, [], 'not a second time');
});

test('notifications: a question notifies at once with its text', () => {
  let r = z.notifications({}, [s('a', 'working')], new Set(), false);
  r = z.notifications(r.memo, [s('a', 'waiting', { question })], new Set(), false);
  assert.deepStrictEqual(r.notifications, [{ id: 'a', title: 'a is asking', body: 'Continue?' }]);
});

test('notifications: a visible tab in the focused window does not notify', () => {
  let r = z.notifications({}, [s('a', 'working')], new Set(['a']), true);
  r = z.notifications(r.memo, [s('a', 'waiting', { question })], new Set(['a']), true);
  assert.deepStrictEqual(r.notifications, []);
  r = z.notifications({}, [s('a', 'working')], new Set(['a']), false);
  r = z.notifications(r.memo, [s('a', 'waiting', { question })], new Set(['a']), false);
  assert.strictEqual(r.notifications.length, 1, 'a window in the background still notifies');
});

test('card: oldest question, visible ones excluded, count', () => {
  const l = [s('a', 'waiting', { question, changedAt: 30 }), s('b', 'waiting', { question, changedAt: 10 }),
    s('c', 'waiting', { question, changedAt: 5 }), s('d', 'waiting')];
  const k = z.card(l, new Set(['c']));
  assert.strictEqual(k.session.id, 'b');
  assert.strictEqual(k.count, 2);
  assert.strictEqual(z.card([s('d', 'waiting')], new Set()), null);
  assert.strictEqual(z.card([s('e', 'waiting', { question: { text: 'x', options: [] } })], new Set()), null);
});

test('newer compares versions numerically', () => {
  assert.strictEqual(z.newer('0.10.0', '0.9.9'), true);
  assert.strictEqual(z.newer('0.1.0', '0.1.0'), false);
  assert.strictEqual(z.newer('0.1.0', '1.0.0'), false);
});

test('backoff: 1, 2, 5, 10, then 30 s', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 9].map(z.backoff), [1000, 2000, 5000, 10000, 30000, 30000]);
});

test('search: prefix before substring before scattered letters, the rest drops out', () => {
  const e = ['New session: shop', 'shop', 'Settings', 'Check for updates'].map(text => ({ text }));
  assert.deepStrictEqual(z.search(e, 'sho').map(x => x.text), ['shop', 'New session: shop']);
  assert.deepStrictEqual(z.search(e, 'cfu').map(x => x.text), ['Check for updates']);
  assert.strictEqual(z.search(e, '').length, 4);
  assert.strictEqual(z.search(e, 'xyz').length, 0);
});

test('contextPercent: against 250k, otherwise the percent from the status line', () => {
  assert.strictEqual(z.contextPercent({ tokensK: 135, contextPct: 14 }), 54);
  assert.strictEqual(z.contextPercent({ tokensK: 213, contextPct: 21 }), 85);
  assert.strictEqual(z.contextPercent({ tokensK: 260, contextPct: 26 }), 100);
  assert.strictEqual(z.contextPercent({ tokensK: 150, windowK: 200 }), 75, 'smaller window counts');
  assert.strictEqual(z.contextPercent({ tokensK: null, contextPct: 14 }), 14);
  assert.strictEqual(z.contextPercent({}), null);
});

test('matches: artifacts, images and code paths with line, no URLs or versions', () => {
  const t = x => z.matches(x).map(m => [m.kind, m.target, m.line || 0]);
  assert.deepStrictEqual(t('see https://claude.ai/artifact/2qoSyg-x and /tmp/a/b.png'),
    [['artifact', 'https://claude.ai/artifact/2qoSyg-x', 0], ['image', '/tmp/a/b.png', 0]]);
  assert.deepStrictEqual(t('in src/ui/app.js:120 and main.js'), [['file', 'src/ui/app.js', 120], ['file', 'main.js', 0]]);
  assert.deepStrictEqual(t('/srv/x/package.json, done'), [['file', '/srv/x/package.json', 0]]);
  assert.deepStrictEqual(t('https://github.com/a/b/blob/main/app.js example.com version 0.7.2'), []);
  const [a] = z.matches('  > abc.py');
  assert.deepStrictEqual([a.index, a.length], [4, 6]);
});

test('splitDiff: files with plus/minus, header lines drop out', () => {
  const d = z.splitDiff([
    'diff --git a/app.js b/app.js', 'index 1..2 100644', '--- a/app.js', '+++ b/app.js',
    '@@ -1,2 +1,2 @@', ' same', '-old', '+new', '+more', 'diff --git a/x.css b/x.css', '@@ -1 +1 @@', '-a',
  ].join('\n'));
  assert.deepStrictEqual(d.map(f => [f.name, f.plus, f.minus, f.lines.length]), [['app.js', 2, 1, 5], ['x.css', 0, 1, 2]]);
  assert.deepStrictEqual(z.splitDiff(''), []);
});

test('splitDiff: "--- x" inside a hunk is content, name from +++ b/', () => {
  const d = z.splitDiff([
    'diff --git a/q b/x.sql b/q b/x.sql', '--- a/q b/x.sql', '+++ b/q b/x.sql',
    '@@ -1,2 +1,2 @@', '--- old comment', '+++ new counter', '+x',
    'diff --git a/gone.js b/gone.js', 'deleted file mode 100644', '--- a/gone.js', '+++ /dev/null', '@@ -1 +0,0 @@', '-a',
  ].join('\n'));
  assert.deepStrictEqual(d.map(f => [f.name, f.plus, f.minus, f.lines.length]), [['q b/x.sql', 2, 1, 4], ['gone.js', 0, 1, 2]]);
});

// Screen of a real AskUserQuestion with multiSelect, cursor on the fourth option
const MULTI = `←  ☒ Fruit  ☐ Color  ✔ Submit  →

Which fruit?

  1. [ ] Apple
         A red or green apple
  2. [ ] Pear
         A sweet pear
  3. [✔] Cherry
         A small red cherry
❯ 4. [✔] Mango
     Next
────────────────────────────────────────
  5. Chat about this

Enter to select · Tab/Arrow keys to navigate · Esc to cancel
`;

test('readMenu: rows with Next and cursor', () => {
  const m = z.readMenu(MULTI);
  assert.strictEqual(m.cursor, 3);
  assert.deepStrictEqual(m.rows.map(r => (r.next ? 'next' : r.n)), [1, 2, 3, 4, 'next', 5]);
  assert.strictEqual(m.rows[2].text, '[✔] Cherry');
  const e = z.readMenu('Done?\n\n❯ 1. Submit answers\n  2. Cancel\n');
  assert.deepStrictEqual([e.cursor, e.rows.length], [0, 2]);
  assert.strictEqual(z.readMenu('nothing'), null);
});

test('option: checkbox and free text', () => {
  assert.deepStrictEqual(z.option({ n: 3, text: '[✔] Cherry', free: false }), { n: 3, text: 'Cherry', box: true, checked: true, free: false });
  assert.deepStrictEqual(z.option({ n: 4, text: '[ ] Type something', free: false }), { n: 4, text: 'Type something', box: true, checked: false, free: true });
  assert.deepStrictEqual(z.option({ n: 1, text: 'Yes', free: false }), { n: 1, text: 'Yes', box: false, checked: false, free: false });
});

const PROMPT = '─'.repeat(40);
test('readPane: working, asking, context and artifact', () => {
  const working = z.readPane(`> fix it\n✽ Ionizing\u2026 (1m 24s · ↓ 6.7k tokens)\n${PROMPT}\n> \n${PROMPT}\nOpus | 42% ctx (84k/200k)`);
  assert.deepStrictEqual([working.working, working.asking, working.contextPct, working.tokensK, working.windowK], [true, false, 42, 84, 200]);
  const asking = z.readPane(`Done: https://claude.ai/artifact/abc-1\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n\nEnter to confirm`);
  assert.strictEqual(asking.asking, true);
  assert.deepStrictEqual(asking.question, { text: 'Do you want to proceed?', options: [{ n: 1, text: 'Yes', free: false }, { n: 2, text: 'No', free: false }] });
  assert.strictEqual(asking.artifact, 'https://claude.ai/artifact/abc-1');
  const idle = z.readPane(`all done\n${PROMPT}\n> \n${PROMPT}\n`);
  assert.deepStrictEqual([idle.working, idle.asking, idle.question], [false, false, null]);
});

test('snapshot: waiting after a change, idle after WAITING_MS, artifact remembered', () => {
  const raw = screen => [{ name: 'shop', cwd: '/srv/shop', created: 100, screen }];
  let r = z.snapshot(raw('see https://claude.ai/artifact/x1'), {}, 1000);
  assert.deepStrictEqual([r.sessions[0].state, r.sessions[0].id, r.sessions[0].created], ['waiting', 'shop', 100000]);
  r = z.snapshot(raw('scrolled away'), r.glances, 2000);
  assert.strictEqual(r.sessions[0].artifact, 'https://claude.ai/artifact/x1');
  r = z.snapshot(raw('scrolled away'), r.glances, 2000 + z.WAITING_MS + 1);
  assert.strictEqual(r.sessions[0].state, 'idle');
});
