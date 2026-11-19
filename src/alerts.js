// -----------------------------------------------------------------------------
// The transitions behind the scene triggers, read after read:
//
//   - a container stopped without Gladys asking: running at the previous read
//     and not any more (crash, out of memory, `podman stop` by hand), or
//     restarted by its restart policy in between (its restart counter grew);
//   - a container turning unhealthy: its healthcheck fails (Podman says
//     `unhealthy` once the retries are spent), announced once per episode.
//
// A stop, a restart or a start asked through Gladys (switch, action, widget,
// scene) is expected: it fires nothing — a scene stopping a container must
// not trigger itself.
//
// The state is saved under /data (src/store.js): a restart of the integration
// neither misses a transition nor announces one twice. The very first read
// (nothing saved) only records the states, without events. The containers
// seen with a healthcheck are remembered too, so that their `healthy`
// feature stays in the device while they are stopped.
// -----------------------------------------------------------------------------

export const ALERT_TIMINGS = {
  // An operation asked through Gladys stays expected this long at most.
  expectedForMs: 10 * 60_000,
  // A container gone for that long is forgotten.
  forgetAfterMs: 7 * 24 * 3600_000,
};

export class Watcher {
  /** @param {object} [saved] what `saved` returned before (src/store.js) */
  constructor(saved = {}, timings = {}) {
    this.timings = { ...ALERT_TIMINGS, ...timings };
    this.seeded = saved.seeded === true;
    this.containers = { ...saved.containers };
    this.withHealth = new Set(Array.isArray(saved.withHealth) ? saved.withHealth : []);
    // The host announced unreachable: not announced again after a restart.
    this.unreachable = saved.unreachable === true;
    // name -> until (ms): operations asked through Gladys, in memory only.
    this.expected = new Map();
  }

  /** What to save under /data. */
  get saved() {
    return {
      seeded: this.seeded,
      containers: this.containers,
      withHealth: [...this.withHealth].sort(),
      unreachable: this.unreachable,
    };
  }

  /** Gladys is about to stop or restart `name`: no event for it. */
  expect(name, now) {
    this.expected.set(name, now + this.timings.expectedForMs);
  }

  /** The operation asked through Gladys is over, and read back. */
  done(name) {
    this.expected.delete(name);
  }

  /** Whether `name` is known to have a healthcheck. */
  hasHealth(name) {
    return this.withHealth.has(name);
  }

  /**
   * Gladys refused the event of a transition: put the previous state back, so
   * that the next read announces it again.
   */
  retry(kind, event) {
    const entry = this.containers[event.name];
    if (!entry) {
      return;
    }
    if (kind === 'stopped') {
      entry.running = true;
      entry.restarts = event.previousRestarts;
    } else if (kind === 'unhealthy') {
      entry.health = null;
    }
  }

  /**
   * Compare a snapshot with the previous one.
   * @returns {{ stopped: object[], unhealthy: object[] }} the transitions to announce
   */
  apply(snapshot, now) {
    const found = { stopped: [], unhealthy: [] };
    const seen = new Set();
    for (const container of snapshot.containers) {
      const { name } = container;
      seen.add(name);
      if (container.health) {
        this.withHealth.add(name);
      }
      const previous = this.containers[name];
      const until = this.expected.get(name);
      const expected = until !== undefined && until > now;
      if (until !== undefined && (!expected || !container.running)) {
        // Seen stopped (the operation is done) or expired.
        this.expected.delete(name);
      }
      if (this.seeded && previous && !expected) {
        const stoppedNow = previous.running && !container.running;
        const restartedByPolicy = container.restarts > (previous.restarts ?? 0);
        if (stoppedNow || restartedByPolicy) {
          found.stopped.push({ ...container, previousRestarts: previous.restarts ?? 0 });
        }
      }
      if (
        this.seeded &&
        previous &&
        container.health === 'unhealthy' &&
        previous.health !== 'unhealthy'
      ) {
        found.unhealthy.push(container);
      }
      this.containers[name] = {
        running: container.running,
        // Kept while stopped: one announcement per unhealthy episode.
        health: container.running ? container.health : (previous?.health ?? null),
        restarts: container.restarts,
        seenAt: now,
      };
    }
    for (const [name, entry] of Object.entries(this.containers)) {
      if (!seen.has(name)) {
        // Removed: its next container under that name starts afresh.
        entry.running = false;
        entry.restarts = 0;
        if (now - (entry.seenAt ?? 0) > this.timings.forgetAfterMs) {
          delete this.containers[name];
          this.withHealth.delete(name);
        }
      }
    }
    this.seeded = true;
    return found;
  }
}
