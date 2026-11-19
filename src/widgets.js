// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `containers`.
//
// The use case: a glance at the wall tablet tells whether the home server's
// containers are fine, and one of them can be restarted from there (the
// media server that hangs, the game server for the evening). Two tiles
// (running out of total, unhealthy), then the containers, the problems first:
// unhealthy, stopped with an error, stopped, running — or the container
// devices only, once some were added. A container chosen in the settings
// gets Start or Stop and Restart buttons.
//
// The names are the ones given in Gladys when the device was added, the
// Podman names otherwise. The list, the buttons and Refresh can be hidden.
//
// Budget (8 components, 2 texts, 4 buttons): one heading, two tiles, one
// status list of ten rows at most, three buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { DEVICE_TYPES, containerDeviceId, deviceIds, parseDeviceId } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { OPERATIONS } from './podman/client.js';
import { HEALTH } from './podman/model.js';
import { errorText, labelled, pick } from './texts.js';

// Action keys of the buttons: permanent once published.
export const ACTIONS = Object.freeze({
  START: 'start',
  STOP: 'stop',
  RESTART: 'restart',
  REFRESH: 'refresh',
});

export const MAX_ROWS = 10;

export const TEXT = {
  notConfigured: {
    en: 'Enter the address of the Podman API service in the configuration of the integration.',
    fr: "Saisissez l'adresse du service d'API Podman dans la configuration de l'intégration.",
    de: 'Gib die Adresse des Podman-API-Dienstes in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección del servicio de API de Podman en la configuración de la integración.',
  },
  waiting: {
    en: 'Waiting for the first answer of Podman…',
    fr: 'En attente de la première réponse de Podman…',
    de: 'Warte auf die erste Antwort von Podman …',
    es: 'Esperando la primera respuesta de Podman…',
  },
  running: { en: 'Running', fr: 'En marche', de: 'Laufend', es: 'En marcha' },
  unhealthy: { en: 'Unhealthy', fr: 'Mauvaise santé', de: 'Fehlerhaft', es: 'Mala salud' },
  healthy: { en: 'Healthy', fr: 'En bonne santé', de: 'Gesund', es: 'En buen estado' },
  starting: { en: 'Starting', fr: 'Démarrage', de: 'Startet', es: 'Iniciando' },
  stopped: { en: 'Stopped', fr: 'Arrêté', de: 'Gestoppt', es: 'Detenido' },
  exitCode: { en: 'Exit', fr: 'Code', de: 'Code', es: 'Código' },
  none: {
    en: 'No container',
    fr: 'Aucun conteneur',
    de: 'Kein Container',
    es: 'Ningún contenedor',
  },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  start: { en: 'Start', fr: 'Démarrer', de: 'Starten', es: 'Iniciar' },
  stop: { en: 'Stop', fr: 'Arrêter', de: 'Stoppen', es: 'Detener' },
  restart: { en: 'Restart', fr: 'Redémarrer', de: 'Neu starten', es: 'Reiniciar' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Podman read again.',
    fr: 'Podman relu.',
    de: 'Podman neu gelesen.',
    es: 'Podman leído de nuevo.',
  },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
// A boolean setting left alone is shown (settings saved before it existed too).
const shown = (settings, key) => settings?.[key] !== false && settings?.[key] !== 'false';

function message(text, language, ttl = 300) {
  return {
    ttl_seconds: ttl,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

// Exit codes of a clean stop: none, or the SIGTERM of `podman stop`.
const CLEAN_EXIT_CODES = new Set([0, 143]);

/** Stopped on an error (a crash, a kill, an out-of-memory). */
const failed = (container) =>
  !container.running && container.exitCode !== null && !CLEAN_EXIT_CODES.has(container.exitCode);

/** Sort order: the problems first. */
function rank(container) {
  if (container.health === HEALTH.UNHEALTHY) {
    return 0;
  }
  if (failed(container)) {
    return 1;
  }
  return container.running ? 3 : 2;
}

/** One row of the status list. */
function row(hub, container, language) {
  const name = hub.gladysName(containerDeviceId(hub.gladys, container.name), container.name);
  let value = t(TEXT.running, language);
  let icon = 'play-circle';
  let color = WIDGET_COLORS.SUCCESS;
  if (container.health === HEALTH.UNHEALTHY) {
    value = t(TEXT.unhealthy, language);
    icon = 'alert-triangle';
    color = WIDGET_COLORS.DANGER;
  } else if (container.health === HEALTH.STARTING) {
    value = t(TEXT.starting, language);
    color = WIDGET_COLORS.WARNING;
  } else if (container.health === HEALTH.HEALTHY) {
    value = t(TEXT.healthy, language);
    icon = 'check-circle';
  } else if (!container.running) {
    icon = 'stop-circle';
    value = failed(container)
      ? `${t(TEXT.stopped, language)} (${t(TEXT.exitCode, language)} ${container.exitCode})`
      : t(TEXT.stopped, language);
    color = failed(container) ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL;
  }
  return { label: fit(name, 40), value: fit(value, 40), icon, color };
}

/** The rows: the added container devices when there are some, every container otherwise. */
export function containerRows(hub, view, language) {
  const added = new Set(
    hub
      .createdDevices()
      .filter((entry) => entry.type === DEVICE_TYPES.CONTAINER)
      .map((entry) => entry.device.external_id),
  );
  const listed = view.snapshot.containers
    .filter((c) => added.size === 0 || added.has(containerDeviceId(hub.gladys, c.name)))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const rows = listed.map((container) => row(hub, container, language));
  if (rows.length === 0) {
    return [
      { label: t(TEXT.none, language), value: '0', icon: 'box', color: WIDGET_COLORS.NEUTRAL },
    ];
  }
  if (rows.length > MAX_ROWS) {
    const kept = rows.slice(0, MAX_ROWS - 1);
    kept.push({
      label: t(TEXT.more, language),
      value: `+${rows.length - kept.length}`,
      icon: 'more-horizontal',
      color: WIDGET_COLORS.NEUTRAL,
    });
    return kept;
  }
  return rows;
}

const button = (text, icon, key, params) => ({
  type: 'button',
  label: fit(text, 24),
  icon,
  style: 'secondary',
  action: { key, params },
});

/** Start or Stop, and Restart, for the container chosen in the settings. */
function containerButtons(hub, view, settings, language) {
  const parsed = parseDeviceId(hub.gladys, settings?.container);
  if (!parsed || parsed.type !== DEVICE_TYPES.CONTAINER || !shown(settings, 'show_buttons')) {
    return [];
  }
  const container = view.snapshot.containers.find(
    (c) => containerDeviceId(hub.gladys, c.name) === settings.container,
  );
  if (!container) {
    return [];
  }
  const params = { container: settings.container };
  const name = hub.gladysName(settings.container, container.name);
  const label = (text) => `${t(text, language)} ${name}`;
  return [
    container.running
      ? button(label(TEXT.stop), 'square', ACTIONS.STOP, params)
      : button(label(TEXT.start), 'play', ACTIONS.START, params),
    button(label(TEXT.restart), 'rotate-cw', ACTIONS.RESTART, params),
  ];
}

async function get(hub, { settings = {}, language = 'en' } = {}) {
  if (!hub.client) {
    return message(TEXT.notConfigured, language);
  }
  const view = hub.view();
  const title = fit(hub.gladysName(deviceIds(hub.gladys, DEVICE_TYPES.HOST).device, view.name), 40);
  const refresh = shown(settings, 'show_refresh')
    ? [button(t(TEXT.refresh, language), 'refresh-cw', ACTIONS.REFRESH, {})]
    : [];
  if (!view.online) {
    if (!view.error) {
      return message(TEXT.waiting, language, 30);
    }
    return {
      ttl_seconds: 30,
      components: [
        { type: 'text', variant: 'heading', text: title },
        {
          type: 'text',
          variant: 'body',
          text: labelled(title, errorText(view.error, language), language),
        },
        ...refresh,
      ],
    };
  }
  const { totals } = view;
  const components = [
    { type: 'text', variant: 'heading', text: title },
    {
      type: 'value',
      value: `${totals.running}/${totals.total}`,
      label: t(TEXT.running, language),
      icon: 'box',
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: totals.unhealthy,
      label: t(TEXT.unhealthy, language),
      icon: 'alert-triangle',
      color: totals.unhealthy > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
  ];
  if (shown(settings, 'show_list')) {
    components.push({ type: 'status', items: containerRows(hub, view, language) });
  }
  return {
    ttl_seconds: 60,
    components: [...components, ...containerButtons(hub, view, settings, language), ...refresh],
  };
}

const OPERATION_OF = {
  [ACTIONS.START]: OPERATIONS.START,
  [ACTIONS.STOP]: OPERATIONS.STOP,
  [ACTIONS.RESTART]: OPERATIONS.RESTART,
};

async function action(hub, { actionKey, params = {} }) {
  if (actionKey === ACTIONS.REFRESH) {
    await hub.pollNow();
    return { message: TEXT.refreshed };
  }
  const operation = OPERATION_OF[actionKey];
  if (!operation) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const result = await hub.operate(params.container, operation);
  return { message: result.message };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
