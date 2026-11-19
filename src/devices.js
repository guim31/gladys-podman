// -----------------------------------------------------------------------------
// The Gladys devices of a Podman machine, proposed in the Discovery tab: the
// user adds the ones to follow, nothing is created on their behalf.
//
//   - the host: reachable, Podman version, containers running, containers in
//     total, unhealthy containers;
//   - one device per container: running (a switch: on = start, off = stop),
//     restarts by the restart policy, and healthy when the container has a
//     healthcheck.
//
// Identity: the container NAME, not its id. A container recreated under the
// same name (a new image with Quadlet, podman-compose, an auto-update) keeps
// its device, its history and its scenes. Podman names are letters, digits,
// `_`, `.` and `-`: kept as is up to 64 characters, hashed beyond.
//
// Published with should_poll: false: the hub reads Podman on its own timer
// (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as CATEGORY,
  DEVICE_FEATURE_TYPES as TYPE,
} from '@gladysassistant/integration-sdk';
import { HEALTH } from './podman/model.js';

export const DEVICE_TYPES = Object.freeze({
  HOST: 'host',
  CONTAINER: 'container',
});

// The platform id of the one host device.
export const HOST_ID = 'main';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  REACHABLE: 'reachable',
  VERSION: 'version',
  CONTAINERS_RUNNING: 'containers_running',
  CONTAINERS_TOTAL: 'containers_total',
  CONTAINERS_UNHEALTHY: 'containers_unhealthy',
  RUNNING: 'running',
  HEALTHY: 'healthy',
  RESTARTS: 'restarts',
});

const K = FEATURE_KEYS;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [K.REACHABLE]: 'Reachable',
    [K.VERSION]: 'Podman version',
    [K.CONTAINERS_RUNNING]: 'Containers running',
    [K.CONTAINERS_TOTAL]: 'Containers',
    [K.CONTAINERS_UNHEALTHY]: 'Unhealthy containers',
    [K.RUNNING]: 'Running',
    [K.HEALTHY]: 'Healthy',
    [K.RESTARTS]: 'Restarts',
  },
  fr: {
    [K.REACHABLE]: 'Joignable',
    [K.VERSION]: 'Version de Podman',
    [K.CONTAINERS_RUNNING]: 'Conteneurs en marche',
    [K.CONTAINERS_TOTAL]: 'Conteneurs',
    [K.CONTAINERS_UNHEALTHY]: 'Conteneurs en mauvaise santé',
    [K.RUNNING]: 'En marche',
    [K.HEALTHY]: 'En bonne santé',
    [K.RESTARTS]: 'Redémarrages',
  },
  de: {
    [K.REACHABLE]: 'Erreichbar',
    [K.VERSION]: 'Podman-Version',
    [K.CONTAINERS_RUNNING]: 'Laufende Container',
    [K.CONTAINERS_TOTAL]: 'Container',
    [K.CONTAINERS_UNHEALTHY]: 'Fehlerhafte Container',
    [K.RUNNING]: 'Läuft',
    [K.HEALTHY]: 'Gesund',
    [K.RESTARTS]: 'Neustarts',
  },
  es: {
    [K.REACHABLE]: 'Accesible',
    [K.VERSION]: 'Versión de Podman',
    [K.CONTAINERS_RUNNING]: 'Contenedores en marcha',
    [K.CONTAINERS_TOTAL]: 'Contenedores',
    [K.CONTAINERS_UNHEALTHY]: 'Contenedores con mala salud',
    [K.RUNNING]: 'En marcha',
    [K.HEALTHY]: 'En buen estado',
    [K.RESTARTS]: 'Reinicios',
  },
};

export const MODELS = {
  [DEVICE_TYPES.HOST]: 'Podman host',
  [DEVICE_TYPES.CONTAINER]: 'Podman container',
};

// Display bound of the counters (the core never applies it on write).
export const COUNT_MAX = 100000;

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const HASHED_KEY = /^h[0-9a-f]{12}$/;

/** The platform id of a container: its name when safe, hashed otherwise. */
export function containerKey(name) {
  if (SAFE_KEY.test(name) && !HASHED_KEY.test(name)) {
    return name;
  }
  return `h${createHash('sha1').update(name).digest('hex').slice(0, 12)}`;
}

/** External ids of a device. */
export const deviceIds = (gladys, type, key = HOST_ID) => gladys.externalIds(type, key);

/** The device external id of a container. */
export const containerDeviceId = (gladys, name) =>
  deviceIds(gladys, DEVICE_TYPES.CONTAINER, containerKey(name)).device;

/**
 * The type and key of a device external id, null when not ours.
 * @returns {{ type: string, key: string }|null}
 */
export function parseDeviceId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return null;
  }
  for (const type of Object.values(DEVICE_TYPES)) {
    const prefix = gladys.externalIds(type, '').device;
    if (externalId.startsWith(prefix)) {
      const key = externalId.slice(prefix.length);
      return SAFE_KEY.test(key) ? { type, key } : null;
    }
  }
  return null;
}

const counter = (key) => ({
  key,
  category: CATEGORY.COUNTER_SENSOR,
  type: TYPE.SENSOR.INTEGER,
  read_only: true,
  has_feedback: false,
  min: 0,
  max: COUNT_MAX,
});
const binary = (key) => ({
  key,
  category: CATEGORY.INPUT,
  type: TYPE.SENSOR.BINARY,
  read_only: true,
  has_feedback: false,
  min: 0,
  max: 1,
});

/** The features of a device type; `healthy` only for a container with a healthcheck. */
export function featureDefinitions(type, { health = false } = {}) {
  if (type === DEVICE_TYPES.HOST) {
    return [
      binary(K.REACHABLE),
      {
        key: K.VERSION,
        category: CATEGORY.TEXT,
        type: TYPE.TEXT.TEXT,
        read_only: true,
        has_feedback: false,
        min: 0,
        max: 0,
      },
      counter(K.CONTAINERS_RUNNING),
      counter(K.CONTAINERS_TOTAL),
      counter(K.CONTAINERS_UNHEALTHY),
    ];
  }
  return [
    {
      key: K.RUNNING,
      category: CATEGORY.SWITCH,
      type: TYPE.SWITCH.BINARY,
      // Commanded: on starts the container, off stops it; the state read
      // back from Podman confirms it.
      read_only: false,
      has_feedback: true,
      min: 0,
      max: 1,
    },
    ...(health ? [binary(K.HEALTHY)] : []),
    counter(K.RESTARTS),
  ];
}

/**
 * A device of the Discovery tab.
 * @param {object} gladys
 * @param {object} entry
 * @param {string} entry.type a DEVICE_TYPES value
 * @param {string} entry.key the platform id (HOST_ID for the host)
 * @param {string} entry.name the device name proposed
 * @param {boolean} [entry.health] the container has a healthcheck
 * @param {string} entry.language feature-name language
 */
export function buildDevice(gladys, { type, key, name, health = false, language }) {
  const ids = deviceIds(gladys, type, key);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name,
    external_id: ids.device,
    model: MODELS[type],
    should_poll: false,
    features: featureDefinitions(type, { health }).map(({ key: featureKey, ...definition }) => ({
      name: names[featureKey],
      external_id: ids.feature(featureKey),
      ...definition,
    })),
  };
}

const bit = (value) => (value ? 1 : 0);

/**
 * The values of a device, `null` when unknown (not sent).
 * @returns {Record<string, number|string|null>} by feature key
 */
export function featureValues(type, item, { reachable = true } = {}) {
  if (type === DEVICE_TYPES.HOST) {
    if (!reachable || !item) {
      return { [K.REACHABLE]: 0 };
    }
    const { snapshot, totals } = item;
    return {
      [K.REACHABLE]: 1,
      [K.VERSION]: snapshot.version || null,
      [K.CONTAINERS_RUNNING]: totals.running,
      [K.CONTAINERS_TOTAL]: totals.total,
      [K.CONTAINERS_UNHEALTHY]: totals.unhealthy,
    };
  }
  if (!item) {
    // A container removed: it no longer runs.
    return { [K.RUNNING]: 0 };
  }
  return {
    [K.RUNNING]: bit(item.running),
    // Unknown while stopped or while the first check runs: not sent.
    [K.HEALTHY]: item.health === HEALTH.HEALTHY ? 1 : item.health === HEALTH.UNHEALTHY ? 0 : null,
    [K.RESTARTS]: item.restarts,
  };
}
