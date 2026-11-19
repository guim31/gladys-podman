import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseApiUrl } from '../src/config.js';

test('the API address accepts what people type', () => {
  assert.equal(parseApiUrl('192.0.2.20'), 'http://192.0.2.20:8888');
  assert.equal(parseApiUrl(' 192.0.2.20:9000 '), 'http://192.0.2.20:9000');
  assert.equal(parseApiUrl('tcp://server.lan:8888'), 'http://server.lan:8888');
  assert.equal(parseApiUrl('http://server.lan:8888/'), 'http://server.lan:8888');
  assert.equal(parseApiUrl('https://proxy.lan/podman'), 'https://proxy.lan/podman');
  assert.equal(parseApiUrl('[2001:db8::1]:8888'), 'http://[2001:db8::1]:8888');
});

test('the API address refuses what cannot work', () => {
  for (const raw of [
    '',
    '   ',
    null,
    42,
    'unix:///run/podman/podman.sock',
    'ftp://server.lan',
    'http://user:pass@server.lan:8888',
    'http://server.lan:8888/?x=1',
    'tcp://0.0.0.0:8888',
    'http://',
  ]) {
    assert.equal(parseApiUrl(raw), null, String(raw));
  }
});

test('normalizeConfig applies the defaults and reports an unusable address', () => {
  const empty = normalizeConfig({});
  assert.equal(empty.url, null);
  assert.equal(empty.name, 'Podman');
  assert.equal(empty.pollIntervalMs, Number(DEFAULT_CONFIG.poll_interval) * 1000);
  assert.equal(empty.language, 'fr');
  assert.deepEqual(empty.problems, []);

  const bad = normalizeConfig({ api_url: 'unix:///run/podman.sock', poll_interval: '7' });
  assert.deepEqual(bad.problems, ['invalidUrl']);
  assert.equal(bad.pollIntervalMs, 30_000);

  const full = normalizeConfig({
    api_url: '192.0.2.20',
    host_name: '  NAS  ',
    poll_interval: 300,
    language: 'de',
  });
  assert.equal(full.url, 'http://192.0.2.20:8888');
  assert.equal(full.name, 'NAS');
  assert.equal(full.pollIntervalMs, 300_000);
  assert.equal(full.language, 'de');
  assert.equal(normalizeConfig(null).url, null);
});
