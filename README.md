# Podman for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the **containers of a Podman machine** into Gladys, through the
Podman REST API on the local network: their state, their health and their
restarts, and a switch to start or stop each of them. No cloud, no account.

> Tested against a real Podman 6.2 (`quay.io/podman/stable`), from the
> integration's own image run with the constraints of the Gladys sandbox.
> Developed without a real Gladys instance: feedback welcome in the
> [issues](https://github.com/guim31/gladys-podman/issues).

## Features

- **One device per container** you choose in the Discovery tab, identified by
  its name (a container recreated under the same name keeps its device):
  - Running, a switch: off stops the container, on starts it;
  - Healthy, for a container with a healthcheck;
  - Restarts by the restart policy.
- **A device for the machine**: reachable, Podman version, containers running,
  in total and unhealthy.
- **Scene triggers**: container stopped unexpectedly (crash, out of memory,
  restart by its policy — never the stops asked by Gladys), container
  unhealthy, Podman unreachable.
- **Scene actions** and configuration buttons: start, stop, restart a
  container; test the connection.
- **Dashboard widget**: containers running and unhealthy, the list with the
  problems first, Start or Stop and Restart buttons for a chosen container.
- English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1.0 or later.
- Podman 4.0 or later on a Linux machine, with its API service listening on
  TCP: `podman system service --time=0 tcp:<address>:8888`. The Gladys sandbox
  cannot reach the Unix socket of Podman.
- **That service has no authentication**: open its port to the Gladys
  machine only (firewall rules in the [documentation](docs/en.md)).

## Installation

In Gladys, **Integrations → Install from GitHub**, address
`https://github.com/guim31/gladys-podman`. Then enter the address of the
Podman API service in the configuration, **Test the connection**, and add
the containers to follow in the **Discovery** tab. The full guide:
[English](docs/en.md), [français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md).

## How it works

The integration reads `GET /v4.0.0/libpod/version` and
`GET /v4.0.0/libpod/containers/json?all=true` at the interval of the
configuration (30 seconds by default), and starts, stops and restarts with
`POST /v4.0.0/libpod/containers/{name}/start|stop|restart`. The `v4.0.0`
libpod API is served by Podman 4, 5 and 6. The devices are published with
`should_poll: false`: the container reads Podman on its own timer, so that the
scene triggers fire for every container, added to Gladys or not. The last
state of each container is kept in `/data/podman-state.json`, so that a
restart of the integration neither misses nor repeats a trigger.

## Checked for real, and what was not

On 19/11/2026, the integration's image run with `--cap-drop ALL
--security-opt no-new-privileges --read-only --memory 256m --pids-limit 256`,
a `/data` volume and a bridge network, against Podman 6.2.0 in Docker
(`quay.io/podman/stable`, rootful, API service on TCP), driven by the fake
Gladys of the SDK:

- the discovery of the machine and of six containers (with and without
  healthcheck, created, exited, in a pod; the infra container left out);
- the switch off and on, the restart action, the stop scene action, an
  unknown container refused in red;
- a container killed behind Gladys' back: `container_stopped` with exit
  code 137; a healthcheck failing three times: `container_unhealthy`; no
  event for the operations asked by Gladys;
- the API service stopped: `podman_unreachable`, the status and the test of
  the connection in red;
- without Gladys, the image retries the connection calmly, 18 MiB of memory
  at rest.

Not checked: a real Gladys instance, a rootless service, Podman 4 and 5,
healthchecks run by systemd timers (they were run by hand in the test
machine, which has no systemd).

## Limitations

- One Podman machine per integration; pods are not devices (their containers
  are).
- No CPU or memory figures (they depend on the cgroups of each machine).
- A Docker engine is not supported, although Podman also serves a
  Docker-compatible API.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Podman API service (`test/helpers/fakePodman.js`) serving the
real Podman 6.2 answers of `test/fixtures/podman/`. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Podman](https://podman.io/) (Apache-2.0) and its
  [REST API reference](https://docs.podman.io/en/latest/_static/api.html). The
  logo on the cover is the official one, from the
  [containers/podman](https://github.com/containers/podman/tree/main/logo)
  repository.
- The architecture and the conformity tests follow
  [gladys-kubernetes](https://github.com/guim31/gladys-kubernetes) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by the Podman
project, the Containers organization or Red Hat.

## License

Apache-2.0
