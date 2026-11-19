// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+): start, stop
// or restart a container chosen among the container devices. "Is it
// running?" is already a scene condition on the device's switch; these
// actions are what a condition cannot do, with the state read back from
// Podman as an output. A failure throws (the scene logs it and goes on).
// -----------------------------------------------------------------------------

import { OPERATIONS } from './podman/client.js';

const run =
  (operation) =>
  async (hub, { fields }) => {
    const result = await hub.operate(fields?.container, operation);
    return { container_name: result.name, running: result.running };
  };

export const SCENE_ACTIONS = {
  start_container: run(OPERATIONS.START),
  stop_container: run(OPERATIONS.STOP),
  restart_container: run(OPERATIONS.RESTART),
};
