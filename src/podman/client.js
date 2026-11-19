// -----------------------------------------------------------------------------
// The Podman REST API (libpod flavour), through `fetch`: the service started by
// `podman system service tcp:…` answers plain HTTP without any credential.
//
//   GET  /v4.0.0/libpod/version                     version of the engine
//   GET  /v4.0.0/libpod/containers/json?all=true    every container, stopped ones too
//   POST /v4.0.0/libpod/containers/{name}/start     204 started, 304 already running
//   POST /v4.0.0/libpod/containers/{name}/stop      204 stopped, 304 already stopped
//   POST /v4.0.0/libpod/containers/{name}/restart   204
//
// `v4.0.0` is the oldest libpod API Podman 4, 5 and 6 still serve (their
// MinAPIVersion): one path for every supported release. Every failure is a
// PodmanError of a kind (ERROR_KINDS) the texts explain to the user.
// -----------------------------------------------------------------------------

export const API_PREFIX = '/v4.0.0/libpod';

export const ERROR_KINDS = Object.freeze({
  // Nothing answers (refused, timed out, DNS, TLS).
  UNREACHABLE: 'unreachable',
  // Something answers, but not the libpod API (Docker, a web page…).
  NOT_PODMAN: 'not_podman',
  // The container named does not exist (any more).
  NOT_FOUND: 'not_found',
  // Podman refused the operation (500: the container cannot start…).
  REFUSED: 'refused',
  // Any other answer.
  HTTP: 'http',
});

// Seconds Podman waits after SIGTERM before SIGKILL (its own default).
export const STOP_TIMEOUT_S = 10;

export const TIMINGS = {
  readTimeoutMs: 10_000,
  // A stop or a restart lasts up to STOP_TIMEOUT_S, plus the start.
  controlTimeoutMs: (STOP_TIMEOUT_S + 20) * 1000,
};

export class PodmanError extends Error {
  /**
   * @param {string} kind an ERROR_KINDS value
   * @param {string} message for the logs (never shown as is to the user)
   * @param {object} [details] `status`, `cause` (the message of Podman)
   */
  constructor(kind, message, details = {}) {
    super(message);
    this.name = 'PodmanError';
    this.kind = kind;
    this.status = details.status ?? null;
    this.cause = details.cause ?? null;
  }
}

// The operations of the container devices, the actions and the widget.
export const OPERATIONS = Object.freeze({
  START: 'start',
  STOP: 'stop',
  RESTART: 'restart',
});

const OPERATION_QUERY = {
  [OPERATIONS.START]: '',
  [OPERATIONS.STOP]: `?timeout=${STOP_TIMEOUT_S}`,
  [OPERATIONS.RESTART]: `?t=${STOP_TIMEOUT_S}`,
};

export class PodmanClient {
  /**
   * @param {object} options
   * @param {string} options.url `http(s)://host:port[/path]` (src/config.js)
   * @param {typeof fetch} [options.fetch] HTTP seam (tests)
   * @param {object} [options.timings] TIMINGS overrides
   */
  constructor({ url, fetch: fetchImpl = globalThis.fetch, timings = {} }) {
    this.url = url;
    this.fetch = fetchImpl;
    this.timings = { ...TIMINGS, ...timings };
  }

  async call(method, path, timeoutMs) {
    let response;
    try {
      response = await this.fetch(`${this.url}${API_PREFIX}${path}`, {
        method,
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err?.cause?.code ?? err?.name ?? 'error';
      throw new PodmanError(ERROR_KINDS.UNREACHABLE, `${method} ${path}: ${reason}`);
    }
    const text = await response.text().catch(() => '');
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body, text };
  }

  async getJson(path) {
    const { status, body } = await this.call('GET', path, this.timings.readTimeoutMs);
    if (status === 200 && body !== null) {
      return body;
    }
    // A Docker engine, a web server or a proxy: 404 or a page that is not JSON.
    if (status === 404 || (status === 200 && body === null)) {
      throw new PodmanError(ERROR_KINDS.NOT_PODMAN, `GET ${path}: no libpod API (${status})`, {
        status,
      });
    }
    throw new PodmanError(ERROR_KINDS.HTTP, `GET ${path}: HTTP ${status}`, {
      status,
      cause: body?.message ?? null,
    });
  }

  /** The engine version and every container, read together. */
  async read() {
    const version = await this.getJson('/version');
    if (typeof version?.Version !== 'string') {
      throw new PodmanError(ERROR_KINDS.NOT_PODMAN, 'GET /version: no Version');
    }
    const containers = await this.getJson('/containers/json?all=true');
    if (!Array.isArray(containers)) {
      throw new PodmanError(ERROR_KINDS.NOT_PODMAN, 'GET /containers/json: not a list');
    }
    return { version: version.Version, containers };
  }

  /**
   * Start, stop or restart a container by name.
   * @returns {Promise<boolean>} false when it already was in that state (304)
   */
  async control(name, operation) {
    if (!(operation in OPERATION_QUERY)) {
      throw new TypeError(`Unknown operation ${operation}`);
    }
    const path = `/containers/${encodeURIComponent(name)}/${operation}${OPERATION_QUERY[operation]}`;
    const { status, body } = await this.call('POST', path, this.timings.controlTimeoutMs);
    if (status === 204) {
      return true;
    }
    if (status === 304) {
      return false;
    }
    const cause = typeof body?.message === 'string' ? body.message : null;
    if (status === 404 && body?.cause === 'no such container') {
      throw new PodmanError(ERROR_KINDS.NOT_FOUND, `POST ${path}: no such container`, {
        status,
        cause,
      });
    }
    if (status === 404) {
      throw new PodmanError(ERROR_KINDS.NOT_PODMAN, `POST ${path}: HTTP 404`, { status });
    }
    if (status === 409 || status === 500) {
      throw new PodmanError(ERROR_KINDS.REFUSED, `POST ${path}: HTTP ${status}`, {
        status,
        cause,
      });
    }
    throw new PodmanError(ERROR_KINDS.HTTP, `POST ${path}: HTTP ${status}`, { status, cause });
  }
}
