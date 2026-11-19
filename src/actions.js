// -----------------------------------------------------------------------------
// Manifest actions (buttons of the Configuration screen). Gladys shows in
// green what a handler returns and in red what it throws: every failure
// (nothing configured, no container chosen, Podman silent or refusing)
// throws an ActionFailure (src/texts.js).
// -----------------------------------------------------------------------------

import { OPERATIONS } from './podman/client.js';

const run = (operation) => async (hub, fields) =>
  (await hub.operate(fields?.container, operation)).message;

export const ACTIONS = {
  test_connection: (hub) => hub.testConnection(),
  start_container: run(OPERATIONS.START),
  stop_container: run(OPERATIONS.STOP),
  restart_container: run(OPERATIONS.RESTART),
};
