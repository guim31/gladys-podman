import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, PodmanClient, PodmanError } from '../src/podman/client.js';
import { parseSnapshot, totals } from '../src/podman/model.js';
import { API_URL, FakePodman } from './helpers/fakePodman.js';

const client = (podman) => new PodmanClient({ url: API_URL, fetch: podman.fetch });

test('reads the version and the containers of the real Podman 6.2 answers', async () => {
  const podman = new FakePodman();
  const raw = await client(podman).read();
  const snapshot = parseSnapshot(raw);
  assert.equal(snapshot.version, '6.2.0');
  // The infra container of the pod is left out.
  assert.deepEqual(
    snapshot.containers.map((c) => [c.name, c.state, c.health, c.restarts, c.exitCode, c.pod]),
    [
      ['crashy', 'exited', null, 3, 3, null],
      ['podmember', 'running', null, 0, 0, 'mypod'],
      ['sick', 'running', 'unhealthy', 0, 0, null],
      ['stopped', 'created', null, 0, 0, null],
      ['web', 'running', 'healthy', 0, 0, null],
    ],
  );
  assert.deepEqual(totals(snapshot), { total: 5, running: 3, unhealthy: 1 });
  assert.deepEqual(podman.calls, [
    'GET /v4.0.0/libpod/version',
    'GET /v4.0.0/libpod/containers/json?all=true',
  ]);
});

const kindOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof PodmanError, err.message);
    return err.kind;
  }
  return 'resolved';
};

test('errors are sorted by kind', async () => {
  const podman = new FakePodman();
  podman.failure = 'down';
  assert.equal(await kindOf(client(podman).read()), ERROR_KINDS.UNREACHABLE);
  podman.failure = 'docker';
  assert.equal(await kindOf(client(podman).read()), ERROR_KINDS.NOT_PODMAN);
  podman.failure = 'html';
  assert.equal(await kindOf(client(podman).read()), ERROR_KINDS.NOT_PODMAN);
  const slow = new PodmanClient({
    url: API_URL,
    fetch: (url, { signal }) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    timings: { readTimeoutMs: 20 },
  });
  assert.equal(await kindOf(slow.read()), ERROR_KINDS.UNREACHABLE);
});

test('start, stop and restart answer as Podman does', async () => {
  const podman = new FakePodman();
  const api = client(podman);
  assert.equal(await api.control('web', 'stop'), true);
  assert.equal(await api.control('web', 'stop'), false);
  assert.equal(await api.control('web', 'start'), true);
  assert.equal(await api.control('web', 'start'), false);
  assert.equal(await api.control('web', 'restart'), true);
  assert.equal(await kindOf(api.control('nope', 'start')), ERROR_KINDS.NOT_FOUND);
  podman.refuse.set('web', 500);
  assert.equal(await kindOf(api.control('web', 'restart')), ERROR_KINDS.REFUSED);
  await assert.rejects(api.control('web', 'pause'), TypeError);
  assert.deepEqual(podman.calls.slice(0, 5), [
    'POST /v4.0.0/libpod/containers/web/stop?timeout=10',
    'POST /v4.0.0/libpod/containers/web/stop?timeout=10',
    'POST /v4.0.0/libpod/containers/web/start',
    'POST /v4.0.0/libpod/containers/web/start',
    'POST /v4.0.0/libpod/containers/web/restart?t=10',
  ]);
});
