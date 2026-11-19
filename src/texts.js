// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, action messages, the "Test the connection"
// report. Four languages, the four of the Gladys interface; German says
// "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, OPERATIONS } from './podman/client.js';

export const LANGUAGE_FALLBACK = 'en';
const LANGS = ['en', 'fr', 'de', 'es'];

/** The text of a multi-language object in a language, English otherwise. */
export const pick = (text, language) => text?.[language] ?? text?.[LANGUAGE_FALLBACK] ?? '';

/** "name: text", with the French space before the colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;

/** Every language of a text built by `render(language)`. */
export const allLanguages = (render) =>
  Object.fromEntries(LANGS.map((language) => [language, render(language)]));

/**
 * A failure shown in red by Gladys: the handler throws it, its message is the
 * multi-language object (a returned value is shown in green, as a success).
 */
export class ActionFailure extends Error {
  constructor(text) {
    super(text.en);
    this.message = text;
  }
}

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Configuration problems (src/config.js `problems`, plus the missing address).
export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of the Podman API service in the configuration.',
    fr: "Saisissez l'adresse du service d'API Podman dans la configuration.",
    de: 'Gib die Adresse des Podman-API-Dienstes in der Konfiguration ein.',
    es: 'Introduzca la dirección del servicio de API de Podman en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. 192.168.1.20:8888 or http://server.lan:8888',
    fr: 'Adresse incomprise, ex. 192.168.1.20:8888 ou http://serveur.lan:8888',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.20:8888 oder http://server.lan:8888',
    es: 'Dirección no válida, p. ej. 192.168.1.20:8888 o http://servidor.lan:8888',
  },
};

// One short explanation per error kind (src/podman/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the Podman API service does not answer',
    fr: "le service d'API Podman ne répond pas",
    de: 'der Podman-API-Dienst antwortet nicht',
    es: 'el servicio de API de Podman no responde',
  },
  [ERROR_KINDS.NOT_PODMAN]: {
    en: 'no Podman API at this address (Docker is not supported)',
    fr: "aucune API Podman à cette adresse (Docker n'est pas pris en charge)",
    de: 'keine Podman-API unter dieser Adresse (Docker wird nicht unterstützt)',
    es: 'no hay ninguna API de Podman en esta dirección (Docker no es compatible)',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'no container of that name on this machine',
    fr: 'aucun conteneur de ce nom sur cette machine',
    de: 'kein Container mit diesem Namen auf dieser Maschine',
    es: 'ningún contenedor con ese nombre en esta máquina',
  },
  [ERROR_KINDS.REFUSED]: {
    en: 'Podman refused, see its logs',
    fr: 'Podman a refusé, voir ses logs',
    de: 'Podman hat abgelehnt, sieh in seinen Protokollen nach',
    es: 'Podman lo ha rechazado, consulte sus registros',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

/** An error of a kind, in a language. */
export const errorText = (error, language) =>
  pick(ERROR_TEXT[error?.kind] ?? ERROR_TEXT[ERROR_KINDS.HTTP], language);

export const ACTION_TEXT = {
  notConfigured: {
    en: 'The integration is not configured yet.',
    fr: "L'intégration n'est pas encore configurée.",
    de: 'Die Integration ist noch nicht konfiguriert.',
    es: 'La integración aún no está configurada.',
  },
  noContainer: {
    en: 'Choose a container.',
    fr: 'Choisissez un conteneur.',
    de: 'Wähle einen Container.',
    es: 'Elija un contenedor.',
  },
  unknownContainer: {
    en: 'This container no longer exists on the Podman machine.',
    fr: "Ce conteneur n'existe plus sur la machine Podman.",
    de: 'Dieser Container existiert auf der Podman-Maschine nicht mehr.',
    es: 'Este contenedor ya no existe en la máquina Podman.',
  },
  unreadable: {
    en: 'Podman cannot be read right now',
    fr: 'Podman est illisible pour le moment',
    de: 'Podman kann gerade nicht gelesen werden',
    es: 'No se puede leer Podman en este momento',
  },
};

// The result of an operation on a container, `name` inserted.
export const OPERATION_TEXT = {
  en: {
    [OPERATIONS.START]: { done: 'started', already: 'already running' },
    [OPERATIONS.STOP]: { done: 'stopped', already: 'already stopped' },
    [OPERATIONS.RESTART]: { done: 'restarted', already: 'restarted' },
    failed: 'failed',
  },
  fr: {
    [OPERATIONS.START]: { done: 'démarré', already: 'déjà en marche' },
    [OPERATIONS.STOP]: { done: 'arrêté', already: 'déjà arrêté' },
    [OPERATIONS.RESTART]: { done: 'redémarré', already: 'redémarré' },
    failed: 'échec',
  },
  de: {
    [OPERATIONS.START]: { done: 'gestartet', already: 'läuft bereits' },
    [OPERATIONS.STOP]: { done: 'gestoppt', already: 'bereits gestoppt' },
    [OPERATIONS.RESTART]: { done: 'neu gestartet', already: 'neu gestartet' },
    failed: 'fehlgeschlagen',
  },
  es: {
    [OPERATIONS.START]: { done: 'iniciado', already: 'ya en marcha' },
    [OPERATIONS.STOP]: { done: 'detenido', already: 'ya detenido' },
    [OPERATIONS.RESTART]: { done: 'reiniciado', already: 'reiniciado' },
    failed: 'error',
  },
};

// "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'connected',
    containers: (running, total) => `containers running: ${running}/${total}`,
    unhealthy: (n) => `unhealthy: ${n}`,
  },
  fr: {
    ok: 'connecté',
    containers: (running, total) => `conteneurs en marche : ${running}/${total}`,
    unhealthy: (n) => `en mauvaise santé : ${n}`,
  },
  de: {
    ok: 'verbunden',
    containers: (running, total) => `laufende Container: ${running}/${total}`,
    unhealthy: (n) => `fehlerhaft: ${n}`,
  },
  es: {
    ok: 'conectado',
    containers: (running, total) => `contenedores en marcha: ${running}/${total}`,
    unhealthy: (n) => `con mala salud: ${n}`,
  },
};
