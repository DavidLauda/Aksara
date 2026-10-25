import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DISABLED_SITES, overlaySettings, setSiteAllowed, siteAllowed, siteOrigin, siteSettings } from '../src/site-settings.ts';

test('page URL maps to an exact HTTP(S) origin without retaining path or query', () => {
  assert.equal(siteOrigin('https://EXAMPLE.com/story?private=1#section'), 'https://example.com');
  assert.equal(siteOrigin('http://example.com:8080/story'), 'http://example.com:8080');
  assert.equal(siteOrigin('https://example.com:443/path'), 'https://example.com');
  for (const url of [null, {}, '', 'relative/path', 'file:///page.html', 'chrome://extensions/', 'data:text/html,test', 'https://user:password@example.com/path']) assert.equal(siteOrigin(url), null);
});

test('stored settings retain canonical origins only and never coerce page URLs into retained browsing history', () => {
  const result = siteSettings({ disabledOrigins: ['https://example.com', 'https://example.com', 'https://EXAMPLE.com', 'https://example.com/path', 'https://example.com?private=1', 'https://user:pass@example.com', 'file:///', false, 'http://example.com:8080'], ignored: 'private text' });
  assert.deepEqual(result, { disabledOrigins: ['https://example.com', 'http://example.com:8080'] });
  assert.deepEqual(siteSettings(undefined), { disabledOrigins: [] });
  assert.deepEqual(siteSettings({ disabledOrigins: 'https://example.com' }), { disabledOrigins: [] });
});

test('disabled preference isolates protocol, hostname and port and enabling restores default behavior', () => {
  const initial = siteSettings(null);
  assert.equal(siteAllowed(initial, 'https://example.com'), true);
  const disabled = setSiteAllowed(initial, 'https://example.com', false);
  assert.equal(siteAllowed(disabled, 'https://example.com'), false);
  for (const origin of ['http://example.com', 'https://sub.example.com', 'https://example.com:8443', 'https://another.example']) assert.equal(siteAllowed(disabled, origin), true);
  assert.deepEqual(setSiteAllowed(disabled, 'https://example.com', true), initial);
  assert.deepEqual(initial, { disabledOrigins: [] });
  assert.deepEqual(setSiteAllowed(disabled, 'https://example.com', false), disabled);
  assert.throws(() => setSiteAllowed(disabled, 'https://example.com/path', false), /INVALID_SITE/);
});

test('the site limit refuses a new exclusion instead of silently enabling an existing disabled site', () => {
  const origins = Array.from({ length: MAX_DISABLED_SITES + 2 }, (_, index) => `https://site${index}.example`);
  const saved = siteSettings({ disabledOrigins: origins });
  assert.equal(saved.disabledOrigins.length, MAX_DISABLED_SITES);
  assert.deepEqual(saved.disabledOrigins, origins.slice(0, MAX_DISABLED_SITES));
  assert.throws(() => setSiteAllowed(saved, origins[MAX_DISABLED_SITES], false), /SITE_LIMIT/);
  assert.equal(setSiteAllowed(saved, origins[0], true).disabledOrigins.length, MAX_DISABLED_SITES - 1);
});

test('overlay contrast defaults to false and accepts only a boolean true', () => {
  for (const value of [null, {}, { highContrast: 'true' }, { highContrast: 1 }, { highContrast: false }]) assert.deepEqual(overlaySettings(value), { highContrast: false });
  assert.deepEqual(overlaySettings({ highContrast: true, ignored: 'text' }), { highContrast: true });
});
