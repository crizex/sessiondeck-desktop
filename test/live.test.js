const test = require('node:test');
const assert = require('node:assert');
const { normalize, localPort, suggest } = require('../main/live');

test('normalize addresses', () => {
  assert.strictEqual(normalize('5173'), 'http://localhost:5173/');
  assert.strictEqual(normalize('localhost:3000/app'), 'http://localhost:3000/app');
  assert.strictEqual(normalize(' example.com '), 'https://example.com/');
  assert.strictEqual(normalize('http://127.0.0.1:8080'), 'http://127.0.0.1:8080/');
  assert.throws(() => normalize('http://'));
});

test('local port only for addresses on the server', () => {
  assert.strictEqual(localPort('http://localhost:5173/'), 5173);
  assert.strictEqual(localPort('http://127.0.0.1/'), 80);
  assert.strictEqual(localPort('https://localhost:5173/'), null);
  assert.strictEqual(localPort('https://example.com/'), null);
});

test('suggestion from package.json', () => {
  const pkg = dev => JSON.stringify({ scripts: { dev } });
  assert.strictEqual(suggest(pkg('vite --port 4000')), 'http://localhost:4000/');
  assert.strictEqual(suggest(pkg('next dev -p 3032')), 'http://localhost:3032/');
  assert.strictEqual(suggest(pkg('PORT=8080 node server.js')), 'http://localhost:8080/');
  assert.strictEqual(suggest(pkg('vite')), 'http://localhost:5173/');
  assert.strictEqual(suggest(pkg('astro dev')), 'http://localhost:4321/');
  assert.strictEqual(suggest(pkg('tsc -p tsconfig.json')), '');
  assert.strictEqual(suggest(''), '');
});
