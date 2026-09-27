// Updates from GitHub Releases of crizex/sessiondeck-desktop (Windows installer only).
// electron-builder publishes latest.yml next to the installer; its sha512 is checked before running it.
// The installer runs silently (NSIS /S), --force-run starts the app again afterwards.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { newer } = require('./state');

const REPO = 'crizex/sessiondeck-desktop';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

// The three fields of latest.yml the updater needs. ponytail: flat YAML only, which is what electron-builder writes.
function parseLatest(yml) {
  const get = k => new RegExp(`^${k}:\\s*'?([^'\\n]+?)'?\\s*$`, 'm').exec(yml)?.[1];
  const info = { version: get('version'), path: get('path'), sha512: get('sha512') };
  if (!info.version || !info.path || !info.sha512) throw new Error('latest.yml incomplete');
  return info;
}

// -> { version, path, sha512, url } when a newer release exists, otherwise null
async function check(current, fetchFn = fetch) {
  const r = await fetchFn(API, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return null; // no release yet
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const rel = await r.json();
  const asset = name => (rel.assets || []).filter(a => a.name === name)[0]?.browser_download_url;
  const yml = asset('latest.yml');
  if (!yml) return null;
  const y = await fetchFn(yml);
  if (!y.ok) throw new Error(`latest.yml ${y.status}`);
  const info = parseLatest(await y.text());
  if (!newer(info.version, current)) return null;
  // GitHub replaces spaces in asset names with dots.
  const base = path.basename(info.path);
  const url = asset(base) || asset(base.replace(/ /g, '.'));
  if (!url) throw new Error(`installer ${base} missing in the release`);
  return { ...info, url };
}

async function download(info, dir, fetchFn = fetch) {
  const r = await fetchFn(info.url);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (crypto.createHash('sha512').update(buf).digest('base64') !== info.sha512) throw new Error('checksum mismatch');
  const file = path.join(dir, path.basename(info.path));
  fs.writeFileSync(file, buf);
  return file;
}

function install(file) {
  spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = { check, download, install, parseLatest, REPO };
