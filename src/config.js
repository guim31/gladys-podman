// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Podman machine: the address of its REST API service
// (`podman system service tcp:0.0.0.0:8888`), a display name, the interval of
// the reads and the language of the texts sent by the container.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// The port of the examples of the Podman documentation.
export const DEFAULT_PORT = 8888;

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['15', '30', '60', '120', '300'];

export const DEFAULT_CONFIG = {
  api_url: '',
  host_name: '',
  poll_interval: '30',
  language: 'fr',
};

export const DEFAULT_HOST_NAME = 'Podman';
export const MAX_NAME_LENGTH = 40;

/**
 * Parse the API address typed by the user: a bare host or IP (`192.0.2.10`,
 * HTTP and port 8888 added), `host:port`, the `tcp://host:port` of
 * `podman system service`, or a full `http(s)://` URL (a reverse proxy with
 * TLS, a path kept). Credentials in the address are refused: they would end
 * up in the logs and the messages.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseApiUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  let text = raw.trim();
  if (!text) {
    return null;
  }
  text = text.replace(/^tcp:\/\//i, 'http://');
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) {
    return null;
  }
  // `0.0.0.0` is where the service listens, not where Gladys can reach it.
  if (url.hostname === '0.0.0.0') {
    return null;
  }
  if (!hasScheme && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const problems = [];
  const typedUrl = text('api_url');
  const url = parseApiUrl(typedUrl);
  if (typedUrl && !url) {
    problems.push('invalidUrl');
  }

  return {
    url,
    name: text('host_name').slice(0, MAX_NAME_LENGTH) || DEFAULT_HOST_NAME,
    problems,
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
