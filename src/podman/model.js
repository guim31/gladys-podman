// -----------------------------------------------------------------------------
// Raw answers of the libpod API -> one snapshot the rest of the code reads.
//
// Field notes, from Podman 6.2 (test/fixtures/podman):
//   - `State` is created, running, paused, exited, stopped, configured,
//     removing or unknown;
//   - for a running container `Status` carries the healthcheck result
//     (`starting`, `healthy`, `unhealthy`), and is empty without a healthcheck;
//   - `Restarts` counts the restarts by the restart policy;
//   - `IsInfra` marks the hidden infra container of a pod, left out here;
//   - `Names` is a list holding the one name of the container.
// -----------------------------------------------------------------------------

export const HEALTH = Object.freeze({
  HEALTHY: 'healthy',
  UNHEALTHY: 'unhealthy',
  STARTING: 'starting',
});

const HEALTH_VALUES = new Set(Object.values(HEALTH));

const integer = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/** One container of the list, null when unusable. */
export function parseContainer(raw) {
  if (!raw || typeof raw !== 'object' || raw.IsInfra === true) {
    return null;
  }
  const name = Array.isArray(raw.Names) ? raw.Names[0] : raw.Names;
  if (typeof name !== 'string' || !name) {
    return null;
  }
  const state = typeof raw.State === 'string' ? raw.State.toLowerCase() : 'unknown';
  const running = state === 'running';
  const status = typeof raw.Status === 'string' ? raw.Status.toLowerCase() : '';
  return {
    name,
    id: typeof raw.Id === 'string' ? raw.Id : '',
    image: typeof raw.Image === 'string' ? raw.Image : '',
    state,
    running,
    // Podman only reports the health of a running container.
    health: running && HEALTH_VALUES.has(status) ? status : null,
    restarts: integer(raw.Restarts),
    exitCode: Number.isInteger(raw.ExitCode) ? raw.ExitCode : null,
    pod: typeof raw.PodName === 'string' && raw.PodName ? raw.PodName : null,
  };
}

/**
 * @param {{ version: string, containers: object[] }} raw what PodmanClient.read returned
 */
export function parseSnapshot(raw) {
  const containers = (raw.containers ?? [])
    .map(parseContainer)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { version: raw.version, containers };
}

/** The figures of the host device, the widget and the scene action. */
export function totals(snapshot) {
  const { containers } = snapshot;
  return {
    total: containers.length,
    running: containers.filter((c) => c.running).length,
    unhealthy: containers.filter((c) => c.health === HEALTH.UNHEALTHY).length,
  };
}
