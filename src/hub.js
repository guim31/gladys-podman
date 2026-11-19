// -----------------------------------------------------------------------------
// The Podman hub: the machine read on a timer of the container (the interval
// chosen in the configuration); the states of the devices the user added
// published to Gladys when they change, the scene events fired on transitions
// (src/alerts.js), the operations on containers (switch, actions, widget,
// scenes), and the views the widget reads.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire for every container, added to Gladys or not.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { Watcher } from './alerts.js';
import {
  DEVICE_TYPES,
  HOST_ID,
  buildDevice,
  containerDeviceId,
  containerKey,
  deviceIds,
  featureValues,
  parseDeviceId,
} from './devices.js';
import { ERROR_KINDS, OPERATIONS, PodmanClient, PodmanError } from './podman/client.js';
import { parseSnapshot, totals } from './podman/model.js';
import { hostOf } from './config.js';
import { createIssueLog } from './logs.js';
import {
  ACTION_TEXT,
  ActionFailure,
  CONNECTION_TEXT,
  OPERATION_TEXT,
  REPORT_TEXT,
  allLanguages,
  errorText,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'podman-hub' });

export const WIDGET_KEY = 'containers';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  STOPPED: 'container_stopped',
  UNHEALTHY: 'container_unhealthy',
  UNREACHABLE: 'podman_unreachable',
});

export const HUB_TIMINGS = {
  // A failed read is retried this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before the machine counts as unreachable (scene event).
  downAfterFailures: 2,
  // An unchanged value is sent again after this long (the core marks a value
  // outdated after 48 hours).
  heartbeatMs: 6 * 3600_000,
  // An operation reads Podman first when the last read is older.
  freshMs: 15_000,
};

const MAX_TRANSPORTS_PER_REQUEST = 100;

export class PodmanHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {typeof fetch} [options.fetch] HTTP seam (tests)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.clientTimings] client TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, fetch, timers = true, timings, clientTimings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.clientTimings = clientTimings;
    this.now = now ?? (() => Date.now());
    this.config = null;
    this.client = null;
    this.watcher = new Watcher();
    this.resetRead();
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.pollTimer = null;
    this.retryTimer = null;
    this.polling = null;
    this.stopped = false;
    this.generation = 0;
    // Failures that repeat at every read: one line, then one when they heal.
    this.issues = createIssueLog(logger);
  }

  resetRead() {
    /** @type {object|null} the last snapshot read (src/podman/model.js) */
    this.snapshot = null;
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.readAt = 0;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.watcher = new Watcher(await this.store.load());
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    if (config.url !== this.config?.url) {
      // Another machine: its states are recorded at the first read, not
      // announced as transitions.
      if (this.config) {
        this.watcher = new Watcher({ unreachable: false });
        this.store.save(this.watcher.saved);
      }
      // A read in progress belongs to the previous configuration: ignored.
      this.generation += 1;
      this.polling = null;
      clearTimeout(this.retryTimer);
      this.resetRead();
      this.client = config.url
        ? new PodmanClient({ url: config.url, fetch: this.fetch, timings: this.clientTimings })
        : null;
    }
    if (this.config?.language !== config.language || this.config?.name !== config.name) {
      this.discovered = null;
    }
    this.config = config;
    try {
      await this.pollNow({ publish: true });
    } finally {
      // Even after an unexpected failure: the readings must go on.
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.retryTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.issues.ok('poll', 'Polling works again');
      } catch (err) {
        this.issues.fail('poll', 'error', 'Poll failed', err);
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.pollNow()
        .then(() => this.issues.ok('retry', 'Retry works again'))
        .catch((err) => this.issues.fail('retry', 'error', 'Retry failed', err));
    }, this.timings.retryMs);
    this.retryTimer.unref?.();
  }

  // --- Reading -------------------------------------------------------------------

  /** Read Podman and publish what changed. */
  async pollNow({ publish = false, fresh = false } = {}) {
    const widgetChanged = await this.poll({ fresh });
    await this.publishDevices({ force: publish });
    await this.publishStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** Read Podman again when the last read is older than `freshMs`. */
  async refreshIfStale() {
    if (this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * One read of Podman. Concurrent calls share it, except a `fresh` one: it
   * waits for the read in flight (started before an operation, it may show
   * the old state) and makes a new one.
   * @returns {Promise<boolean>} whether the widget should be refreshed now
   */
  async poll({ fresh = false } = {}) {
    if (!this.client) {
      return false;
    }
    if (fresh) {
      while (this.polling) {
        await this.polling.catch(() => {});
      }
    }
    if (!this.polling) {
      const generation = this.generation;
      const polling = this.read(generation).finally(() => {
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(generation) {
    let raw;
    try {
      raw = await this.client.read();
    } catch (err) {
      if (!(err instanceof PodmanError)) {
        throw err;
      }
      return generation === this.generation ? this.applyFailure(err) : false;
    }
    return generation === this.generation ? this.applySuccess(raw) : false;
  }

  /** A fingerprint of what the widget shows: refreshed when it changes. */
  widgetKey(snapshot) {
    return JSON.stringify(snapshot.containers.map((c) => [c.name, c.state, c.health]));
  }

  async applySuccess(raw) {
    const now = this.now();
    const snapshot = parseSnapshot(raw);
    const widgetChanged =
      this.error !== null ||
      this.readAt === 0 ||
      !this.snapshot ||
      this.widgetKey(this.snapshot) !== this.widgetKey(snapshot);
    if (this.error) {
      logger.info(`${this.config.name} answers again`);
    }
    if (this.snapshot?.version !== snapshot.version) {
      logger.info(
        `${this.config.name} (${hostOf(this.config.url)}): Podman ${snapshot.version}, ${
          snapshot.containers.length
        } containers`,
      );
    }
    this.snapshot = snapshot;
    this.error = null;
    this.failures = 0;
    this.down = false;
    this.readAt = now;
    clearTimeout(this.retryTimer);

    const found = this.watcher.apply(snapshot, now);
    this.watcher.unreachable = false;
    for (const container of found.stopped) {
      logger.debug(`${container.name} stopped (${container.state}, exit ${container.exitCode})`);
      const fired = await this.fireEvent(TRIGGERS.STOPPED, {
        container: containerDeviceId(this.gladys, container.name),
        container_name: container.name,
        state: container.state,
        exit_code: container.exitCode ?? 0,
        restarts: container.restarts,
      });
      if (!fired) {
        this.watcher.retry('stopped', container);
      }
    }
    for (const container of found.unhealthy) {
      logger.debug(`${container.name} unhealthy`);
      const fired = await this.fireEvent(TRIGGERS.UNHEALTHY, {
        container: containerDeviceId(this.gladys, container.name),
        container_name: container.name,
      });
      if (!fired) {
        this.watcher.retry('unhealthy', container);
      }
    }
    this.store.save(this.watcher.saved);
    return widgetChanged;
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`${this.config.name}: ${err.message}`);
    } else {
      logger.debug(`${this.config.name}: ${err.message}`);
    }
    // Only silence counts as unreachable: a wrong address is a configuration
    // problem, reported by the connection status.
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      this.failures = 0;
      return wasError !== err.kind;
    }
    this.failures += 1;
    if (this.failures === 1) {
      this.scheduleRetry();
    }
    if (!this.down && this.failures >= this.timings.downAfterFailures) {
      this.down = true;
      // Already announced before a restart of the integration: not again.
      if (!this.watcher.unreachable) {
        const fired = await this.fireEvent(TRIGGERS.UNREACHABLE, {
          host_name: this.config.name,
        });
        if (fired) {
          this.watcher.unreachable = true;
          this.store.save(this.watcher.saved);
        } else {
          this.down = false; // announced at the next failed read
        }
      }
      return true;
    }
    return wasError !== err.kind;
  }

  /** @returns {Promise<boolean>} whether Gladys accepted the event */
  async fireEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.issues.ok('scene', 'Scene events accepted again');
      return true;
    } catch (err) {
      this.issues.fail('scene', 'warn', `Scene event ${key} refused: ${err.message}`);
      return false;
    }
  }

  // --- Devices -----------------------------------------------------------------

  /** Every device the last snapshot proposes, with its item. */
  items() {
    const { snapshot } = this;
    if (!snapshot) {
      return [];
    }
    return [
      {
        type: DEVICE_TYPES.HOST,
        key: HOST_ID,
        name: this.config.name,
        item: { snapshot, totals: totals(snapshot) },
      },
      ...snapshot.containers.map((container) => ({
        type: DEVICE_TYPES.CONTAINER,
        key: containerKey(container.name),
        name: container.name,
        health: this.watcher.hasHealth(container.name),
        item: container,
      })),
    ];
  }

  discoveredDevices() {
    return this.items().map((entry) =>
      buildDevice(this.gladys, { ...entry, language: this.config.language }),
    );
  }

  /** Publish the Discovery list when it changed (a container created, removed…). */
  async publishDevices({ force = false } = {}) {
    if (!this.snapshot && !force) {
      return;
    }
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.issues.ok('discovery', 'Discovered devices accepted again');
    } catch (err) {
      this.issues.fail('discovery', 'warn', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read Podman, publish the list again. */
  async rediscover() {
    await this.pollNow({ publish: true });
  }

  /** The devices of this integration the user added, with their parsed identity. */
  createdDevices() {
    const devices = [];
    for (const device of this.gladys.devices ?? []) {
      const parsed = parseDeviceId(this.gladys, device.external_id);
      if (parsed) {
        devices.push({ device, ...parsed });
      }
    }
    return devices;
  }

  /** The item a device stands for in the last snapshot, null when gone. */
  itemFor(type, key) {
    return this.items().find((entry) => entry.type === type && entry.key === key)?.item ?? null;
  }

  /** The user added (or updated) a device: Gladys dropped the states sent before. */
  async onDeviceCreated(device) {
    if (!parseDeviceId(this.gladys, device.external_id)) {
      return;
    }
    // The SDK forgot the states of this device: they go again.
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  onDeviceDeleted(device) {
    if (typeof device?.external_id === 'string') {
      this.transports.delete(device.external_id);
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /** The states of the added devices, the changed ones (deduplicated by the SDK). */
  async publishStates() {
    if (!this.snapshot && !this.down) {
      return;
    }
    const states = [];
    for (const { device, type, key } of this.createdDevices()) {
      let values;
      if (this.error) {
        // Nothing read: only say the machine is unreachable, once it is.
        if (!(this.down && type === DEVICE_TYPES.HOST)) {
          continue;
        }
        values = featureValues(type, null, { reachable: false });
      } else {
        values = featureValues(type, this.itemFor(type, key));
      }
      const ids = deviceIds(this.gladys, type, key);
      // A container added before its healthcheck was seen has no such feature.
      const known = Array.isArray(device.features)
        ? new Set(device.features.map((feature) => feature.external_id))
        : null;
      for (const [featureKey, value] of Object.entries(values)) {
        const externalId = ids.feature(featureKey);
        if (value === null || (known && !known.has(externalId))) {
          continue;
        }
        states.push(
          typeof value === 'string'
            ? { device_feature_external_id: externalId, text: value }
            : { device_feature_external_id: externalId, state: value },
        );
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.issues.ok('states', 'States accepted again');
    } catch (err) {
      this.issues.fail('states', 'warn', `States refused: ${err.message}`);
    }
  }

  /** The badge of the added devices: "local", or "unreachable" while Podman fails. */
  async publishTransports() {
    if (this.readAt === 0) {
      return;
    }
    const entries = [];
    for (const { device, type, key } of this.createdDevices()) {
      // A container removed from the machine is unreachable too.
      const reachable =
        this.error === null && (type === DEVICE_TYPES.HOST || this.itemFor(type, key) !== null);
      const transport = reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(device.external_id) !== transport) {
        entries.push({ external_id: device.external_id, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.issues.ok('transports', 'Transports accepted again');
      } catch (err) {
        this.issues.fail('transports', 'warn', `Transports refused: ${err.message}`);
      }
    }
  }

  /** What the configuration lacks, as a multi-language message; null when complete. */
  configProblem() {
    const config = this.config;
    if (config?.problems.length) {
      return allLanguages((language) =>
        config.problems.map((problem) => pick(CONNECTION_TEXT[problem], language)).join('\n'),
      );
    }
    if (!config?.url) {
      return CONNECTION_TEXT.noUrl;
    }
    return null;
  }

  /** The status under the integration name. */
  connectionStatus() {
    const problem = this.configProblem();
    if (problem) {
      return { connected: false, message: problem };
    }
    if (this.error) {
      return {
        connected: false,
        message: allLanguages((language) => errorText(this.error, language)),
      };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.issues.ok('connection', 'Connection status accepted again');
    } catch (err) {
      this.issues.fail('connection', 'warn', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views and operations -------------------------------------------------------

  /** What the widget shows of the machine. */
  view() {
    return {
      name: this.config?.name ?? '',
      online: this.error === null && this.snapshot !== null,
      error: this.error,
      snapshot: this.snapshot,
      totals: this.snapshot ? totals(this.snapshot) : null,
    };
  }

  /** The name given in Gladys to a device, `fallback` when it was not added. */
  gladysName(externalId, fallback) {
    const device = (this.gladys.devices ?? []).find((entry) => entry.external_id === externalId);
    return typeof device?.name === 'string' && device.name.trim() ? device.name : fallback;
  }

  /** "Test the connection": read Podman now and say what was found. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const problem = this.configProblem();
    if (problem) {
      throw new ActionFailure(problem);
    }
    const { name } = this.config;
    if (this.error) {
      throw new ActionFailure(
        allLanguages((language) => labelled(name, errorText(this.error, language), language)),
      );
    }
    const { snapshot } = this;
    const { running, total, unhealthy } = totals(snapshot);
    return allLanguages((language) => {
      const text = REPORT_TEXT[language];
      const parts = [text.ok, `Podman ${snapshot.version}`, text.containers(running, total)];
      if (unhealthy) {
        parts.push(text.unhealthy(unhealthy));
      }
      return labelled(name, parts.join(', '), language);
    });
  }

  /**
   * The container a device external id (the `source: "devices"` selects) or
   * a container name stands for, in a fresh read.
   */
  async resolveContainer(target) {
    if (!this.client) {
      throw new ActionFailure(ACTION_TEXT.notConfigured);
    }
    if (typeof target !== 'string' || !target.trim()) {
      throw new ActionFailure(ACTION_TEXT.noContainer);
    }
    await this.refreshIfStale();
    if (this.error || !this.snapshot) {
      throw new ActionFailure(
        allLanguages((language) =>
          labelled(
            pick(ACTION_TEXT.unreadable, language),
            errorText(this.error, language),
            language,
          ),
        ),
      );
    }
    const parsed = parseDeviceId(this.gladys, target.trim());
    const container = parsed
      ? parsed.type === DEVICE_TYPES.CONTAINER &&
        this.snapshot.containers.find((c) => containerKey(c.name) === parsed.key)
      : this.snapshot.containers.find((c) => c.name === target.trim());
    if (!container) {
      throw new ActionFailure(ACTION_TEXT.unknownContainer);
    }
    return container;
  }

  /**
   * Start, stop or restart a container, then read Podman again so that the
   * switch, the widget and the outputs show the new state.
   * @param {string} target a device external id or a container name
   * @param {string} operation an OPERATIONS value
   * @returns {Promise<{ name: string, running: boolean, message: object }>}
   */
  async operate(target, operation) {
    const container = await this.resolveContainer(target);
    const { name } = container;
    const display = this.gladysName(containerDeviceId(this.gladys, name), name);
    if (operation !== OPERATIONS.START) {
      this.watcher.expect(name, this.now());
    }
    let changed;
    try {
      changed = await this.client.control(name, operation);
    } catch (err) {
      this.watcher.done(name);
      if (!(err instanceof PodmanError)) {
        throw err;
      }
      logger.warn(
        `${operation} ${name} failed: ${err.message}${err.cause ? ` (${err.cause})` : ''}`,
      );
      throw new ActionFailure(
        allLanguages((language) =>
          labelled(
            display,
            `${OPERATION_TEXT[language].failed}, ${errorText(err, language)}`,
            language,
          ),
        ),
      );
    }
    logger.info(`${operation} ${name}${changed ? '' : ' (nothing to do)'}`);
    await this.pollNow({ fresh: true });
    this.watcher.done(name);
    const now = this.snapshot?.containers.find((c) => c.name === name);
    return {
      name,
      running: now ? now.running : operation !== OPERATIONS.STOP,
      message: allLanguages((language) =>
        labelled(
          display,
          OPERATION_TEXT[language][operation][changed ? 'done' : 'already'],
          language,
        ),
      ),
    };
  }

  /** The switch of a container device: 1 starts it, 0 stops it. */
  async setRunning(device, value) {
    const operation = Number(value) === 1 ? OPERATIONS.START : OPERATIONS.STOP;
    await this.operate(device.external_id, operation);
  }
}
