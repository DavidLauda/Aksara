import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
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

test('distribution keeps activation and host access within the reviewed permission boundary', async () => {
  const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
  assert.deepEqual(manifest.permissions.toSorted(), ['activeTab', 'offscreen', 'scripting', 'storage', 'unlimitedStorage']);
  assert.deepEqual(manifest.host_permissions.toSorted(), ['https://*.hf.co/*', 'https://*.huggingface.co/*', 'https://huggingface.co/*']);
  assert.deepEqual(manifest.optional_host_permissions.toSorted(), ['http://*/*', 'https://*/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'; connect-src 'self' http: https:;");
});

test('all extension HTML executable and style entries are local, and privacy links resolve', async () => {
  const root = resolve('dist');
  for (const name of ['popup.html', 'options.html', 'offscreen.html', 'privacy.html']) {
    const path = resolve(root, name), html = await readFile(path, 'utf8');
    for (const match of html.matchAll(/<(script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/g)) {
      assert.doesNotMatch(match[2], /^(?:[a-z]+:|\/\/)/i, `${name}: ${match[2]}`);
      const target = resolve(dirname(path), match[2]);
      assert.ok(!relative(root, target).startsWith('..'), 'Asset must stay within dist.');
      await access(target);
    }
    if (name === 'popup.html' || name === 'options.html') assert.match(html, /href="(?:\.\/)?privacy\.html"/);
  }
  assert.doesNotMatch(await readFile('dist/privacy.html', 'utf8'), /<script\b/);
});

test('development fixtures, test entry points and model weights are excluded from dist', async () => {
  async function visit(path) {
    for (const file of await readdir(path, { withFileTypes: true })) {
      const target = `${path}/${file.name}`;
      assert.doesNotMatch(file.name, /cache-probe|comic-|\.onnx$|(?:^|-)test(?:s|-)|fixture/i, target);
      if (file.isDirectory()) await visit(target);
    }
  }
  await visit('dist');
});
