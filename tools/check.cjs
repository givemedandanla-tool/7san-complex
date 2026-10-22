const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const pkg = path.join(root, 'dist/InvitationFallback');
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
for (const p of walk(pkg)) {
  if (p.endsWith('.json')) JSON.parse(fs.readFileSync(p, 'utf8'));
  if (p.endsWith('.js')) new vm.Script(fs.readFileSync(p, 'utf8'), { filename: p });
}
const hashes = JSON.parse(fs.readFileSync(path.join(pkg, 'PACKAGE_SHA256.json')));
for (const [name, expected] of Object.entries(hashes)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(pkg, name))).digest('hex'), expected, name);
for (const id of ['raiden', 'iansan', 'moonbloom', 'mozailu']) {
  const folder = path.join(pkg, 'engines', id);
  const bank = JSON.parse(fs.readFileSync(path.join(folder, 'hand-bank.json')));
  const opening = JSON.parse(fs.readFileSync(path.join(folder, 'opening-bank.json')));
  for (const b of [bank, opening]) for (const entry of Object.values(b.atlas || {})) assert(fs.existsSync(path.join(folder, entry.file)), id + ': ' + entry.file);
  for (const entry of Object.values(bank.uiAtlas || {})) assert(fs.existsSync(path.join(folder, entry.file)), id + ': ' + entry.file);
  const original = fs.readFileSync(path.join(folder, 'main.js'), 'utf8').split('// @tcg-entry')[0];
  assert(fs.readFileSync(path.join(folder, 'engine.js'), 'utf8').includes(original), 'upstream module body changed: ' + id);
}
assert(fs.existsSync(path.join(pkg, 'README.md')), 'missing trial instructions');
const manifest = JSON.parse(fs.readFileSync(path.join(pkg, 'manifest.json')));
assert(fs.existsSync(path.join(pkg, manifest.main))); assert(fs.existsSync(path.join(pkg, manifest.settings_ui)));
assert.equal(manifest.http_allowed_urls, undefined);
console.log(`Validated JSON/JS, ${Object.keys(hashes).length} file hashes, four atlas banks, original module preservation, and package entry.`);
