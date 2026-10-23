import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';

test('unpacked build contains every hashed local runtime and language asset', async () => {
  const { files } = JSON.parse(await readFile('dist/asset-manifest.json', 'utf8'));
  assert.ok(files.some(file => file.path.endsWith('ind.traineddata.gz')));
  assert.ok(files.some(file => file.path.endsWith('.wasm')));
  for (const file of files) {
    const bytes = await readFile(`dist/${file.path}`);
    assert.equal(bytes.length, file.bytes, file.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
});
test('MV3 entries resolve locally and content script parses as a classic script', async () => {
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, 'module');
  assert.ok(manifest.content_security_policy.extension_pages.includes("script-src 'self' 'wasm-unsafe-eval'"));
  for (const path of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, 'offscreen.html']) await access(`dist/${path}`);
  new Script(await readFile('dist/content.js', 'utf8'));
  const offscreen = await readFile('dist/offscreen.js', 'utf8');
  assert.doesNotMatch(offscreen, /translation\.worker\.ts/);
});
