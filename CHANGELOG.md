# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The containers of a Podman machine in Gladys, through the Podman REST API
  (`podman system service tcp:…`, Podman 4.0 or later): one device per
  container, identified by its name, with Running (a switch that starts and
  stops it), Healthy (with a healthcheck) and Restarts; a device for the
  machine with its reachability, the Podman version and the counts of
  containers running, in total and unhealthy.
- Scene triggers: container stopped unexpectedly (crash, out of memory,
  restart by its policy — not the stops asked by Gladys), container unhealthy,
  Podman unreachable.
- Scene actions and configuration buttons: start, stop and restart a
  container; Test the connection.
- Dashboard widget: containers running and unhealthy, the list of the
  containers with the problems first, Start or Stop and Restart buttons for a
  chosen container.
- Texts, feature names and documentation in English, French, German and
  Spanish.
