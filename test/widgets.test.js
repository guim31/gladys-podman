// -----------------------------------------------------------------------------
// The `containers` widget: valid content in the core vocabulary in every
// language, the problems first, the buttons of the chosen container, and the
// actions behind them.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { containerId, createDevices, createWorld } from './helpers/world.js';

async function world(t, options) {
  const result = await createWorld(options);
  t.after(() => result.app.stop());
  return result;
}

const content = async (w, settings = {}, language = 'en') => {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, JSON.stringify(ack.error));
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  return ack.data.content;
};

test('valid in every language, within the budget of the core', async (t) => {
  const w = await world(t);
  for (const language of ['en', 'fr', 'de', 'es']) {
    const c = await content(w, { container: containerId(w.gladys, 'web') }, language);
    assert.ok(c.components.length <= 8);
    assert.ok(c.components.filter((x) => x.type === 'text').length <= 2);
    assert.ok(c.components.filter((x) => x.type === 'button').length <= 4);
  }
});

test('the problems first, then the stopped and running containers', async (t) => {
  const w = await world(t);
  const c = await content(w);
  const [, running, unhealthy, status] = c.components;
  assert.equal(running.value, '3/5');
  assert.equal(unhealthy.value, 1);
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value, item.color]),
    [
      ['sick', 'Unhealthy', 'danger'],
      ['crashy', 'Stopped (Exit 3)', 'danger'],
      ['stopped', 'Stopped', 'neutral'],
      ['podmember', 'Running', 'success'],
      ['web', 'Healthy', 'success'],
    ],
  );
  // No button without a chosen container: only Refresh.
  assert.deepEqual(
    c.components.filter((x) => x.type === 'button').map((x) => x.action.key),
    ['refresh'],
  );
});

test('once containers are added, only they are listed, under their Gladys name', async (t) => {
  const w = await world(t);
  await createDevices(w, (d) => d.name === 'web');
  const web = w.fake.devices.find((d) => d.name === 'web');
  await w.fake.deviceUpdated({ ...web, name: 'Jellyfin' });
  const c = await content(w);
  const status = c.components.find((x) => x.type === 'status');
  assert.deepEqual(
    status.items.map((item) => item.label),
    ['Jellyfin'],
  );
});

test('the chosen container gets Stop and Restart, and they act', async (t) => {
  const w = await world(t);
  const container = containerId(w.gladys, 'web');
  let c = await content(w, { container });
  let buttons = c.components.filter((x) => x.type === 'button');
  assert.deepEqual(
    buttons.map((b) => [b.label, b.action.key]),
    [
      ['Stop web', 'stop'],
      ['Restart web', 'restart'],
      ['Refresh', 'refresh'],
    ],
  );
  const stop = await w.fake.widgetAction(WIDGET_KEY, 'stop', buttons[0].action.params, {
    settings: { container },
  });
  assert.equal(stop.success, true);
  assert.equal(stop.data.message.en, 'web: stopped');
  c = await content(w, { container });
  buttons = c.components.filter((x) => x.type === 'button');
  assert.equal(buttons[0].action.key, 'start');

  w.podman.refuse.set('web', 500);
  const failed = await w.fake.widgetAction(WIDGET_KEY, 'start', { container }, {});
  assert.equal(failed.success, false);
  assert.match(failed.error.fr, /échec/);
  const refresh = await w.fake.widgetAction(WIDGET_KEY, 'refresh', {}, {});
  assert.equal(refresh.success, true);
});

test('every block can be hidden', async (t) => {
  const w = await world(t);
  const c = await content(w, {
    container: containerId(w.gladys, 'web'),
    show_list: false,
    show_buttons: false,
    show_refresh: false,
  });
  assert.deepEqual(
    c.components.map((x) => x.type),
    ['text', 'value', 'value'],
  );
});

test('not configured, or Podman silent: said in words', async (t) => {
  const empty = await world(t, { config: {} });
  assert.match((await content(empty)).components[0].text, /Enter the address/);
  const w = await world(t);
  w.podman.failure = 'down';
  await w.hub.pollNow();
  const c = await content(w, {}, 'fr');
  assert.equal(c.components[1].text, "Home server : le service d'API Podman ne répond pas");
});
