// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and the fake Podman (real answers of
// Podman 6.2): discovery, states, the switch, the actions, the scene
// triggers, the persistence under /data, the logs and the own timer.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { TRIGGERS } from '../src/hub.js';
import {
  FakePodman,
  baseConfig,
  containerId,
  createClock,
  createDevices,
  createWorld,
  hostId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const result = await createWorld({ clock: createClock(), ...options });
  t.after(() => result.app.stop());
  return result;
}

const feature = (w, name, key) => `${containerId(w.gladys, name)}:${key}`;
const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);

/** The lines written at `LOG_LEVEL=info` from now on. */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  for (const stream of ['log', 'error']) {
    t.mock.method(console, stream, (...args) => lines.push(args.join(' ')));
  }
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

test('discovery proposes the host and every container, nothing created on its own', async (t) => {
  const w = await world(t);
  const devices = w.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Home server', 'crashy', 'podmember', 'sick', 'stopped', 'web'],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
  const web = devices.find((d) => d.name === 'web');
  const running = web.features.find((f) => f.external_id.endsWith(':running'));
  assert.equal(running.category, 'switch');
  assert.equal(running.read_only, false);
  assert.equal(running.has_feedback, true);
  // A healthcheck is seen on web and sick only.
  assert.ok(web.features.some((f) => f.external_id.endsWith(':healthy')));
  const stopped = devices.find((d) => d.name === 'stopped');
  assert.ok(!stopped.features.some((f) => f.external_id.endsWith(':healthy')));
  assert.equal(w.fake.states.length, 0, 'no state before a device is added');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('adding a device publishes its states; a crash changes them', async (t) => {
  const w = await world(t);
  await createDevices(w);
  assert.equal(w.fake.lastState(`${hostId(w.gladys)}:reachable`), 1);
  assert.equal(w.fake.lastState(`${hostId(w.gladys)}:version`), '6.2.0');
  assert.equal(w.fake.lastState(`${hostId(w.gladys)}:containers_running`), 3);
  assert.equal(w.fake.lastState(`${hostId(w.gladys)}:containers_unhealthy`), 1);
  assert.equal(w.fake.lastState(feature(w, 'web', 'running')), 1);
  assert.equal(w.fake.lastState(feature(w, 'web', 'healthy')), 1);
  assert.equal(w.fake.lastState(feature(w, 'sick', 'healthy')), 0);
  assert.equal(w.fake.lastState(feature(w, 'crashy', 'restarts')), 3);
  assert.ok(w.fake.widgetRefreshes.length > 0);

  const before = w.fake.states.length;
  await w.hub.pollNow();
  assert.equal(w.fake.states.length, before, 'nothing changed, nothing published');

  w.podman.setState('web', 'exited', { Status: '', ExitCode: 137 });
  await w.hub.pollNow();
  assert.equal(w.fake.lastState(feature(w, 'web', 'running')), 0);
  assert.equal(w.fake.lastState(`${hostId(w.gladys)}:containers_running`), 2);
  // While stopped, the health is unknown: not sent, and the feature stays.
  assert.equal(w.fake.lastState(feature(w, 'web', 'healthy')), 1);
  await w.hub.rediscover();
  const web = w.fake.discoveredDevices.find((d) => d.name === 'web');
  assert.ok(web.features.some((f) => f.external_id.endsWith(':healthy')));
});

test('the switch starts and stops the container, without firing a trigger', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const device = w.fake.devices.find((d) => d.name === 'web');
  const running = device.features.find((f) => f.external_id.endsWith(':running'));
  assert.deepEqual(await w.fake.setValue(device, running, 0), { success: true });
  assert.ok(w.podman.calls.includes('POST /v4.0.0/libpod/containers/web/stop?timeout=10'));
  assert.equal(w.fake.lastState(running.external_id), 0);
  assert.deepEqual(await w.fake.setValue(device, running, 1), { success: true });
  assert.equal(w.fake.lastState(running.external_id), 1);
  w.clock.advance(30_000);
  await w.hub.pollNow();
  assert.deepEqual(w.fake.sceneEvents, []);

  w.podman.refuse.set('web', 500);
  const ack = await w.fake.setValue(device, running, 0);
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /web : échec, Podman a refusé/);
});

test('actions: green messages on success, red failures with a reason', async (t) => {
  const w = await world(t);
  const web = containerId(w.gladys, 'web');

  let ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.fr,
    'Home server : connecté, Podman 6.2.0, conteneurs en marche : 3/5, en mauvaise santé : 1',
  );

  ack = await w.fake.action('stop_container', { container: web });
  assert.deepEqual(ack, {
    success: true,
    data: {
      message: { en: 'web: stopped', fr: 'web : arrêté', de: 'web: gestoppt', es: 'web: detenido' },
    },
  });
  ack = await w.fake.action('stop_container', { container: web });
  assert.equal(ack.data.message.fr, 'web : déjà arrêté');
  ack = await w.fake.action('start_container', { container: web });
  assert.equal(ack.data.message.en, 'web: started');
  ack = await w.fake.action('restart_container', { container: web });
  assert.equal(ack.data.message.en, 'web: restarted');

  ack = await w.fake.action('start_container', {});
  assert.equal(ack.success, false);
  assert.equal(ack.error.fr, 'Choisissez un conteneur.');

  ack = await w.fake.action('start_container', { container: hostId(w.gladys) });
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /n'existe plus/);

  w.podman.containers = w.podman.containers.filter((c) => c.Names[0] !== 'web');
  w.clock.advance(60_000);
  ack = await w.fake.action('start_container', { container: web });
  assert.equal(ack.success, false);
  assert.match(ack.error.en, /no longer exists/);

  w.podman.failure = 'down';
  w.clock.advance(60_000);
  ack = await w.fake.action('restart_container', { container: web });
  assert.equal(ack.success, false);
  assert.match(ack.error.fr, /illisible/);
  ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, false);
  assert.equal(ack.error.fr, "Home server : le service d'API Podman ne répond pas");
});

test('actions without configuration fail, and the status says what to do', async (t) => {
  const w = await world(t, { config: { language: 'en' } });
  const ack = await w.fake.action('restart_container', { container: 'web' });
  assert.equal(ack.success, false);
  assert.equal(ack.error.fr, "L'intégration n'est pas encore configurée.");
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /Saisissez l'adresse/);
  const bad = await world(t, { config: { api_url: 'unix:///run/podman.sock' } });
  assert.match(bad.fake.connectionStatus.message.en, /Address not understood/);
  assert.equal((await bad.fake.action('test_connection', {})).success, false);
});

test('scene actions return the container and its state read back', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('stop_container', {
    container: containerId(w.gladys, 'web'),
  });
  assert.deepEqual(ack.data.outputs, { container_name: 'web', running: false });
  const failed = await w.fake.sceneAction('start_container', { container: 'nope' });
  assert.equal(failed.success, false);
});

test('a crash fires "stopped unexpectedly" once, a restart by policy too', async (t) => {
  const w = await world(t);
  w.podman.setState('web', 'exited', { Status: '', ExitCode: 137 });
  await w.hub.pollNow();
  await w.hub.pollNow();
  assert.deepEqual(events(w, TRIGGERS.STOPPED), [
    {
      key: TRIGGERS.STOPPED,
      data: {
        container: containerId(w.gladys, 'web'),
        container_name: 'web',
        state: 'exited',
        exit_code: 137,
        restarts: 0,
      },
    },
  ]);
  // Restarted by its policy between two reads: still running, counter + 1.
  w.podman.container('podmember').Restarts = 1;
  await w.hub.pollNow();
  assert.equal(events(w, TRIGGERS.STOPPED).at(-1).data.container_name, 'podmember');
  assert.equal(events(w, TRIGGERS.STOPPED).at(-1).data.state, 'running');
  assert.equal(events(w, TRIGGERS.STOPPED).length, 2);
});

test('the first read only records; a restart of the integration announces nothing twice', async (t) => {
  const w = await world(t);
  // The fixtures already hold an unhealthy and a crashed container.
  assert.deepEqual(w.fake.sceneEvents, []);
  w.podman.setState('web', 'running', { Status: 'unhealthy' });
  await w.hub.pollNow();
  assert.equal(events(w, TRIGGERS.UNHEALTHY).length, 1);
  await w.hub.pollNow();
  assert.equal(events(w, TRIGGERS.UNHEALTHY).length, 1, 'once per episode');
  await w.app.stop();

  const again = await world(t, { podman: w.podman, dataDir: w.dataDir });
  await again.hub.pollNow();
  assert.deepEqual(again.fake.sceneEvents, []);
  // Healthy again, then unhealthy: a new episode.
  w.podman.setState('web', 'running', { Status: 'healthy' });
  await again.hub.pollNow();
  w.podman.setState('web', 'running', { Status: 'unhealthy' });
  await again.hub.pollNow();
  assert.equal(events(again, TRIGGERS.UNHEALTHY).length, 1);
});

test('an event Gladys refused is announced at the next read', async (t) => {
  const w = await world(t);
  const publish = w.gladys.publishSceneEvent.bind(w.gladys);
  let refuse = true;
  t.mock.method(w.gladys, 'publishSceneEvent', async (...args) => {
    if (refuse) {
      throw new GladysApiError(429, 'TOO_MANY_REQUESTS', 'slow down');
    }
    return publish(...args);
  });
  w.podman.setState('web', 'exited', { Status: '', ExitCode: 1 });
  await w.hub.pollNow();
  assert.equal(events(w, TRIGGERS.STOPPED).length, 0);
  refuse = false;
  await w.hub.pollNow();
  assert.equal(events(w, TRIGGERS.STOPPED).length, 1);
});

test('Podman silent twice: unreachable, once per outage, devices marked', async (t) => {
  const w = await world(t);
  await createDevices(w);
  w.podman.failure = 'down';
  await w.hub.pollNow();
  assert.equal(events(w, TRIGGERS.UNREACHABLE).length, 0, 'a blip is not an outage');
  await w.hub.pollNow();
  await w.hub.pollNow();
  assert.deepEqual(events(w, TRIGGERS.UNREACHABLE), [
    { key: TRIGGERS.UNREACHABLE, data: { host_name: 'Home server' } },
  ]);
  assert.equal(w.fake.lastState(`${hostId(w.gladys)}:reachable`), 0);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.equal(w.fake.connectionStatus.message.de, 'der Podman-API-Dienst antwortet nicht');
  const transports = new Map(w.fake.transports.map((e) => [e.device_external_id, e.transport]));
  assert.equal(transports.get(containerId(w.gladys, 'web')), 'unreachable');

  w.podman.failure = null;
  await w.hub.pollNow();
  assert.equal(w.fake.lastState(`${hostId(w.gladys)}:reachable`), 1);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  // A container that was running all along fired nothing.
  assert.equal(events(w, TRIGGERS.STOPPED).length, 0);
});

test('a Docker engine or a web page at the address is a configuration problem', async (t) => {
  const w = await world(t);
  w.podman.failure = 'docker';
  await w.hub.pollNow();
  await w.hub.pollNow();
  assert.equal(events(w, TRIGGERS.UNREACHABLE).length, 0);
  assert.match(w.fake.connectionStatus.message.en, /Docker is not supported/);
});

test('another address starts afresh', async (t) => {
  const w = await world(t);
  w.podman.setState('web', 'exited', { Status: '', ExitCode: 1 });
  await w.fake.configUpdated(baseConfig({ api_url: '198.51.100.7' }));
  assert.equal(w.hub.client.url, 'http://198.51.100.7:8888');
  assert.deepEqual(w.fake.sceneEvents, [], 'the first read of the other machine only records');
});

test('a normal cycle writes nothing at the info level', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const lines = captureLogs(t);
  w.podman.setState('web', 'exited', { Status: '', ExitCode: 1 });
  w.podman.setState('sick', 'running', { Status: 'healthy' });
  for (let read = 0; read < 4; read += 1) {
    w.clock.advance(31_000);
    await w.hub.pollNow();
  }
  await w.hub.rediscover();
  assert.ok(w.fake.sceneEvents.length >= 1);
  assert.deepEqual(lines, []);

  w.podman.failure = 'down';
  for (let read = 0; read < 4; read += 1) {
    await w.hub.pollNow();
  }
  w.podman.failure = null;
  await w.hub.pollNow();
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /ECONNREFUSED/);
  assert.match(lines[1], /answers again/);
});

test('the container reads Podman on its own timer, without any poll from Gladys', async (t) => {
  const podman = new FakePodman();
  const w = await world(t, { podman, timers: true, config: baseConfig({ poll_interval: '15' }) });
  await createDevices(w);
  t.mock.timers?.reset?.();
  const reads = () => podman.calls.filter((c) => c.endsWith('containers/json?all=true')).length;
  const before = reads();
  // Shorten the wait: the interval is read from the config at each schedule.
  w.hub.config.pollIntervalMs = 20;
  w.hub.schedulePoll();
  podman.setState('web', 'exited', { Status: '', ExitCode: 1 });
  await sleep(120);
  assert.ok(reads() > before, 'read again by the timer');
  assert.equal(w.fake.lastState(feature(w, 'web', 'running')), 0);
});
