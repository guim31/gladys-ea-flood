// -----------------------------------------------------------------------------
// Texts sent from the container (feature values, connection status, action
// messages, scene variables), in the four languages of the Gladys interface.
// Entries are strings or functions of one parameter object. German says "du",
// Spanish "usted". "Environment Agency" is a name: never translated.
// -----------------------------------------------------------------------------

import { LANGUAGES } from './config.js';

// Names of the low / normal / high states, as the Gladys front shows the
// level-sensor/liquid-state values.
export const STATE_NAMES = {
  en: { low: 'Low', normal: 'Normal', high: 'High' },
  fr: { low: 'Faible', normal: 'Normal', high: 'Élevé' },
  de: { low: 'Niedrig', normal: 'Normal', high: 'Hoch' },
  es: { low: 'Bajo', normal: 'Normal', high: 'Alto' },
};

// The levels of the stage scale a scene can wait for (see MARKS).
export const MARK_NAMES = {
  en: {
    typical_low: 'bottom of the typical range',
    typical_high: 'top of the typical range',
    highest_recent: 'highest recent level',
    max_on_record: 'highest level on record',
  },
  fr: {
    typical_low: 'bas de la plage habituelle',
    typical_high: 'haut de la plage habituelle',
    highest_recent: 'plus haut niveau récent',
    max_on_record: 'plus haut niveau connu',
  },
  de: {
    typical_low: 'Untergrenze des üblichen Bereichs',
    typical_high: 'Obergrenze des üblichen Bereichs',
    highest_recent: 'höchster Stand der letzten Jahre',
    max_on_record: 'höchster gemessener Stand',
  },
  es: {
    typical_low: 'límite inferior del rango habitual',
    typical_high: 'límite superior del rango habitual',
    highest_recent: 'nivel más alto reciente',
    max_on_record: 'nivel más alto registrado',
  },
};

export const TREND_NAMES = {
  en: { rising: 'rising', steady: 'steady', falling: 'falling' },
  fr: { rising: 'monte', steady: 'stable', falling: 'baisse' },
  de: { rising: 'steigt', steady: 'gleichbleibend', falling: 'fällt' },
  es: { rising: 'sube', steady: 'estable', falling: 'baja' },
};

// The three levels of the flood warning service, and "none".
export const SEVERITY_NAMES = {
  en: {
    severe: 'Severe flood warning',
    warning: 'Flood warning',
    alert: 'Flood alert',
    none: 'None',
  },
  fr: {
    severe: 'Alerte crue grave',
    warning: 'Alerte crue',
    alert: 'Vigilance crue',
    none: 'Aucune',
  },
  de: {
    severe: 'Schwere Hochwasserwarnung',
    warning: 'Hochwasserwarnung',
    alert: 'Hochwasservorwarnung',
    none: 'Keine',
  },
  es: {
    severe: 'Aviso grave de inundación',
    warning: 'Aviso de inundación',
    alert: 'Alerta de inundación',
    none: 'Ninguna',
  },
};

// Values of the "Last reading" and "Latest warning" features.
export const READINGS = {
  en: {
    staleSince: ({ date }) => `No new reading since ${date}`,
    noAlert: 'No flood warning in force',
  },
  fr: {
    staleSince: ({ date }) => `Pas de nouvelle mesure depuis le ${date}`,
    noAlert: 'Aucune alerte crue en cours',
  },
  de: {
    staleSince: ({ date }) => `Keine neue Messung seit ${date}`,
    noAlert: 'Keine Hochwasserwarnung aktiv',
  },
  es: {
    staleSince: ({ date }) => `Sin nueva medición desde el ${date}`,
    noAlert: 'Ninguna alerta de crecidas en vigor',
  },
};

// Connection status of the Configuration screen.
export const STATUS = {
  en: {
    initFailed: 'Initialization failed, check the integration logs.',
    down: 'The Environment Agency does not answer: the readings will come back with it.',
    unknown: ({ names }) => `Unknown station: ${names}. Use "Find stations".`,
    homeFailed:
      'Around my house: the nearest stations or flood areas cannot be chosen yet, tried again at the next refresh.',
    noHouse: 'Around my house: give your house a location in Gladys (Settings, Houses).',
    tooMany: ({ max }) => `Only the first ${max} stations are followed.`,
    none: 'No station yet: fill in the configuration, or use "Find stations".',
  },
  fr: {
    initFailed: "L'initialisation a échoué, consultez les logs de l'intégration.",
    down: "L'Environment Agency ne répond pas : les mesures reviendront avec elle.",
    unknown: ({ names }) => `Station inconnue : ${names}. Utilisez « Chercher des stations ».`,
    homeFailed:
      'Autour de ma maison : les stations ou zones les plus proches ne peuvent pas encore être choisies, nouvel essai à la prochaine mise à jour.',
    noHouse:
      'Autour de ma maison : indiquez la position de votre maison dans Gladys (Paramètres, Maisons).',
    tooMany: ({ max }) => `Seules les ${max} premières stations sont suivies.`,
    none: 'Aucune station : remplissez la configuration, ou utilisez « Chercher des stations ».',
  },
  de: {
    initFailed: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
    down: 'Die Environment Agency antwortet nicht: Die Messwerte kommen mit ihr zurück.',
    unknown: ({ names }) => `Unbekannte Station: ${names}. Nutze „Stationen suchen“.`,
    homeFailed:
      'Rund um mein Haus: Die nächsten Stationen oder Gebiete können noch nicht gewählt werden, neuer Versuch bei der nächsten Aktualisierung.',
    noHouse: 'Rund um mein Haus: Gib deinem Haus in Gladys einen Standort (Einstellungen, Häuser).',
    tooMany: ({ max }) => `Nur die ersten ${max} Stationen werden verfolgt.`,
    none: 'Noch keine Station: Fülle die Konfiguration aus oder nutze „Stationen suchen“.',
  },
  es: {
    initFailed: 'La inicialización ha fallado, consulte los registros de la integración.',
    down: 'La Environment Agency no responde: las mediciones volverán con ella.',
    unknown: ({ names }) => `Estación desconocida: ${names}. Use «Buscar estaciones».`,
    homeFailed:
      'Alrededor de mi casa: aún no se pueden elegir las estaciones o zonas más cercanas, nuevo intento en la próxima actualización.',
    noHouse: 'Alrededor de mi casa: indique la ubicación de su casa en Gladys (Ajustes, Casas).',
    tooMany: ({ max }) => `Solo se siguen las ${max} primeras estaciones.`,
    none: 'Aún no hay estaciones: rellene la configuración o use «Buscar estaciones».',
  },
};

// Messages of the "Find stations" action.
export const SEARCH = {
  en: {
    noHouse:
      'Your house has no location in Gladys: type a station name, a river (Thames, Severn…), a town or a station reference.',
    none: 'No station found.',
    found: ({ count, total }) =>
      `${total > count ? `${count} of ${total}` : count} station(s). Copy the references into "Stations", then save:`,
    unavailable: 'The Environment Agency does not answer, try again in a few minutes.',
    noRecent: 'no recent reading',
  },
  fr: {
    noHouse:
      "Votre maison n'a pas de position dans Gladys : tapez un nom de station, un cours d'eau (Thames, Severn…), une ville ou une référence de station.",
    none: 'Aucune station trouvée.',
    found: ({ count, total }) =>
      `${total > count ? `${count} sur ${total}` : count} station(s). Copiez les références dans « Stations », puis enregistrez :`,
    unavailable: "L'Environment Agency ne répond pas, réessayez dans quelques minutes.",
    noRecent: 'pas de mesure récente',
  },
  de: {
    noHouse:
      'Dein Haus hat in Gladys keinen Standort: Gib einen Stationsnamen, ein Gewässer (Thames, Severn…), einen Ort oder eine Stationskennung ein.',
    none: 'Keine Station gefunden.',
    found: ({ count, total }) =>
      `${total > count ? `${count} von ${total}` : count} Station(en). Kopiere die Kennungen in „Stationen“ und speichere:`,
    unavailable: 'Die Environment Agency antwortet nicht, versuche es in ein paar Minuten erneut.',
    noRecent: 'keine aktuelle Messung',
  },
  es: {
    noHouse:
      'Su casa no tiene ubicación en Gladys: escriba el nombre de una estación, un río (Thames, Severn…), una ciudad o una referencia de estación.',
    none: 'No se ha encontrado ninguna estación.',
    found: ({ count, total }) =>
      `${total > count ? `${count} de ${total}` : count} estación(es). Copie las referencias en «Estaciones» y guarde:`,
    unavailable: 'La Environment Agency no responde, inténtelo de nuevo en unos minutos.',
    noRecent: 'sin medición reciente',
  },
};

/** One entry of a message table, in every language: `{ en, fr, de, es }`. */
export function render(table, key, params = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const entry = table[language][key];
      return [language, typeof entry === 'function' ? entry(params) : entry];
    }),
  );
}

/** Several multi-language texts joined, language by language. */
export function join(...messages) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      messages
        .filter(Boolean)
        .map((message) => message[language])
        .join(' '),
    ]),
  );
}

/** A date in the user's time zone (TZ, set by the Gladys supervisor), e.g. "13/10 18:35". */
export function formatDate(time, language) {
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
}

/** A number in the user's language, e.g. "2,59" in French. */
export function formatNumber(value, language, digits = 2) {
  return new Intl.NumberFormat(language === 'en' ? 'en-GB' : language, {
    maximumFractionDigits: digits,
  }).format(value);
}

/** "Label: value", with the French space before the colon. */
export const labelled = (label, value, language) =>
  `${label}${language === 'fr' ? ' : ' : ': '}${value}`;

/** A water level in metres, e.g. "4.58 m" ("4,58 m" in French). */
export function formatHeight(value, language) {
  return `${formatNumber(value, language)} m`;
}
