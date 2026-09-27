const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const updater = require('../updater');

const body = Buffer.from('installer');
const sha512 = crypto.createHash('sha512').update(body).digest('base64');
const yml = v => `version: ${v}\nfiles:\n  - url: SessionDeck-Setup-${v}.exe\npath: SessionDeck-Setup-${v}.exe\nsha512: ${sha512}\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`;
const res = (status, data) => ({ ok: status < 400, status, json: async () => data, text: async () => data, arrayBuffer: async () => body });
// Fake GitHub: /releases/latest with latest.yml and the installer as assets.
const github = (v, status = 200) => async url => {
  if (url === `https://api.github.com/repos/${updater.REPO}/releases/latest`) {
    return res(status, { assets: [{ name: 'latest.yml', browser_download_url: 'https://dl/latest.yml' }, { name: `SessionDeck-Setup-${v}.exe`, browser_download_url: 'https://dl/setup.exe' }] });
  }
  if (url === 'https://dl/latest.yml') return res(200, yml(v));
  return res(200, body);
};

test('parseLatest reads version, path and sha512', () => {
  assert.deepStrictEqual(updater.parseLatest(yml('1.2.3')), { version: '1.2.3', path: 'SessionDeck-Setup-1.2.3.exe', sha512 });
  assert.throws(() => updater.parseLatest('version: 1.0.0\n'), /incomplete/);
});

test('check reports only a newer release', async () => {
  assert.strictEqual((await updater.check('1.0.0', github('1.1.0'))).url, 'https://dl/setup.exe');
  assert.strictEqual(await updater.check('1.1.0', github('1.1.0')), null);
  assert.strictEqual(await updater.check('1.0.0', github('1.1.0', 404)), null, 'no release yet');
});

test('download checks the sha512', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessiondeck-'));
  const file = await updater.download({ url: 'x', path: 'SessionDeck-Setup-1.1.0.exe', sha512 }, dir, github('1.1.0'));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'installer');
  await assert.rejects(updater.download({ url: 'x', path: 'bad.exe', sha512: 'x' }, dir, github('1.1.0')), /checksum/);
  assert.strictEqual(fs.existsSync(path.join(dir, 'bad.exe')), false);
  fs.rmSync(dir, { recursive: true });
});
