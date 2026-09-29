// The macOS updater, played through on any OS: a child process pretends to be darwin, checks, installs and exits;
// the detached script must then swap the .app bundle and call "open".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

test('macOS: reads latest-mac-<arch>.yml, swaps the .app after quitting and opens it', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-mac-'));
  const app = path.join(d, 'Applications', 'SessionDeck.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'marker'), 'old');
  fs.mkdirSync(path.join(d, 'new', 'SessionDeck.app'), { recursive: true });
  fs.writeFileSync(path.join(d, 'new', 'SessionDeck.app', 'marker'), 'new');
  const pkg = path.join(d, 'SessionDeck-9.9.9-mac-arm64.tar.gz');
  execFileSync('tar', ['-czf', pkg, '-C', path.join(d, 'new'), 'SessionDeck.app']);
  fs.mkdirSync(path.join(d, 'bin'));
  fs.writeFileSync(path.join(d, 'bin', 'open'), `#!/bin/sh\necho "$1" > ${d}/opened\n`, { mode: 0o755 });

  const child = `
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    Object.defineProperty(process, 'arch', { value: 'arm64' });
    process.execPath = ${JSON.stringify(path.join(app, 'Contents', 'MacOS', 'SessionDeck'))};
    const u = require(${JSON.stringify(path.join(__dirname, '..', 'updater'))});
    const res = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => data });
    const fake = async url => (url.endsWith('/releases/latest')
      ? res({ assets: [{ name: 'latest.yml', browser_download_url: 'https://dl/latest.yml' },
          { name: 'latest-mac-arm64.yml', browser_download_url: 'https://dl/latest-mac-arm64.yml' },
          { name: 'SessionDeck-9.9.9-mac-arm64.tar.gz', browser_download_url: 'https://dl/mac.tar.gz' }] })
      : url === 'https://dl/latest-mac-arm64.yml' ? res('version: 9.9.9\\npath: SessionDeck-9.9.9-mac-arm64.tar.gz\\nsha512: x\\n')
      : res('', 404));
    u.check('1.0.0', fake).then(i => { console.log(i.url); u.install(${JSON.stringify(pkg)}); });`;
  const out = execFileSync(process.execPath, ['-e', child], { env: { ...process.env, PATH: `${d}/bin:${process.env.PATH}` } }).toString();
  assert.strictEqual(out.trim(), 'https://dl/mac.tar.gz');

  for (let i = 0; i < 50 && !fs.existsSync(path.join(d, 'opened')); i++) await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(fs.readFileSync(path.join(d, 'opened'), 'utf8').trim(), app);
  assert.strictEqual(fs.readFileSync(path.join(app, 'marker'), 'utf8'), 'new');
  fs.rmSync(d, { recursive: true, force: true });
});
