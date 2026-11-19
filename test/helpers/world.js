// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Podman API service, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs unless `timers` is set: the tests
// read Podman with `world.hub.pollNow()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { containerDeviceId, deviceIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { API_URL, FakePodman } from './fakePodman.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// One minute after the fixtures were captured.
export const FIXTURE_TIME = Date.parse('2026-11-19T20:53:00Z');

/** A manual clock, shared by the hub and the tests. */
export function createClock(start = FIXTURE_TIME) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const baseConfig = (extra = {}) => ({
  api_url: API_URL,
  host_name: 'Home server',
  language: 'en',
  ...extra,
});

export async function createWorld({
  clock = createClock(),
  podman = new FakePodman(),
  config = baseConfig(),
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-podman-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    fetch: podman.fetch,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, podman, app, hub: app.hub, clock, dataDir };
}

export const hostId = (gladys) => deviceIds(gladys, 'host').device;
export const containerId = (gladys, name) => containerDeviceId(gladys, name);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { API_URL, FakePodman };
