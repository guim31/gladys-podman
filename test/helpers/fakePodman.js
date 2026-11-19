// -----------------------------------------------------------------------------
// A fake Podman API service, served through a `fetch` seam: the real answers
// of Podman 6.2 (test/fixtures/podman, captured on quay.io/podman/stable),
// the containers editable by the tests, and start/stop/restart applied to
// them the way Podman answers (204, 304, 404).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/podman/${name}.json`, import.meta.url), 'utf8'));

export const API_URL = 'http://192.0.2.20:8888';

export class FakePodman {
  constructor() {
    this.version = fixture('version');
    this.containers = fixture('containers');
    this.notFound = fixture('no-such-container');
    /** 'down' (connection refused), 'docker' (404 everywhere), 'html', or null */
    this.failure = null;
    /** name -> HTTP status forced on its next operations */
    this.refuse = new Map();
    this.calls = [];
    this.fetch = this.fetch.bind(this);
  }

  container(name) {
    return this.containers.find((c) => c.Names[0] === name);
  }

  setState(name, state, extra = {}) {
    Object.assign(this.container(name), { State: state, ...extra });
  }

  async fetch(url, options = {}) {
    const method = options.method ?? 'GET';
    const { pathname, search } = new URL(url);
    this.calls.push(`${method} ${pathname}${search}`);
    if (this.failure === 'down') {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    }
    if (this.failure === 'docker') {
      return new Response('{"message":"page not found"}', { status: 404 });
    }
    if (this.failure === 'html') {
      return new Response('<html>hello</html>', { status: 200 });
    }
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (method === 'GET' && pathname === '/v4.0.0/libpod/version') {
      return json(this.version);
    }
    if (method === 'GET' && pathname === '/v4.0.0/libpod/containers/json') {
      return json(this.containers);
    }
    const match = pathname.match(/^\/v4\.0\.0\/libpod\/containers\/([^/]+)\/(start|stop|restart)$/);
    if (method === 'POST' && match) {
      const name = decodeURIComponent(match[1]);
      const container = this.container(name);
      if (!container) {
        return json(this.notFound, 404);
      }
      if (this.refuse.has(name)) {
        return json(
          { cause: 'crun', message: 'OCI runtime error: something failed', response: 500 },
          this.refuse.get(name),
        );
      }
      const running = container.State === 'running';
      if (match[2] === 'start' && running) {
        return new Response(null, { status: 304 });
      }
      if (match[2] === 'stop' && !running) {
        return new Response(null, { status: 304 });
      }
      if (match[2] === 'stop') {
        Object.assign(container, { State: 'exited', Status: '', ExitCode: 143, Exited: true });
      } else {
        Object.assign(container, { State: 'running', ExitCode: 0, Exited: false });
      }
      return new Response(null, { status: 204 });
    }
    return json({ message: 'not found' }, 404);
  }
}
