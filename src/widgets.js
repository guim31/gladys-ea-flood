// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `flood`.
//
// Without setting: a heading naming the most severe flood warning in force
// around the house, then ONE status list (the core keeps one per widget, 10
// lines): one line per warning (4 at most, or "none in force"), then one line
// per followed station, as many as fit: the water level
// and its trend, coloured by its state (closed palette of the widgets: high
// danger, normal success, low info; neutral without a typical range or a
// recent reading).
//
// With a device chosen in the settings: a station shows its live water level
// and flow tiles (bound to the device features), then its state, highest
// recent level, trend and last reading; the "Flood alerts" device lists every
// warning in force.
//
// Both end with the source and its date and a link to "Check for flooding".
// Budget: 2 texts, 1 status, 2 tiles, 1 button. Headings hold 40 characters.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { stationIds, stationRefOfId } from './devices.js';
import { SITE_URL, SEVERITIES, areaPage, stationPage } from './ea.js';
import { SEVERITY_NAMES, STATE_NAMES, TREND_NAMES, formatDate, formatHeight } from './messages.js';
import { WIDGET_KEY } from './monitor.js';

export const MAX_STATUS_ITEMS = 10;
export const MAX_ALERT_ITEMS = 4;
export const TTL_SECONDS = 300;
const MAX_STATUS_TEXT = 40;

export const TEXT = {
  empty: {
    en: 'Nothing followed yet: fill in the configuration of the Environment Agency integration, then create the devices in the Discover tab.',
    fr: "Rien n'est suivi pour l'instant : remplissez la configuration de l'intégration Environment Agency, puis créez les appareils dans l'onglet Découverte.",
    de: 'Noch nichts verfolgt: Fülle die Konfiguration der Integration Environment Agency aus und lege dann die Geräte im Tab „Entdecken“ an.',
    es: 'Aún no se sigue nada: rellene la configuración de la integración Environment Agency y, después, cree los dispositivos en la pestaña Descubrir.',
  },
  gone: {
    en: 'This device is no longer followed.',
    fr: "Cet appareil n'est plus suivi.",
    de: 'Dieses Gerät wird nicht mehr verfolgt.',
    es: 'Este dispositivo ya no se sigue.',
  },
  warnings: {
    en: 'Flood warnings',
    fr: 'Alertes crues',
    de: 'Hochwasserwarnungen',
    es: 'Alertas de crecidas',
  },
  noneInForce: {
    en: 'None in force',
    fr: 'Aucune en cours',
    de: 'Keine aktiv',
    es: 'Ninguna en vigor',
  },
  more: { en: 'more', fr: 'autres', de: 'weitere', es: 'más' },
  height: { en: 'Water level', fr: "Hauteur d'eau", de: 'Wasserstand', es: 'Nivel del agua' },
  flow: { en: 'Flow (m³/s)', fr: 'Débit (m³/s)', de: 'Abfluss (m³/s)', es: 'Caudal (m³/s)' },
  state: { en: 'State', fr: 'État', de: 'Lage', es: 'Estado' },
  highestRecent: {
    en: 'Highest recent',
    fr: 'Plus haut récent',
    de: 'Höchster Stand',
    es: 'Más alto reciente',
  },
  trend: { en: 'Trend', fr: 'Tendance', de: 'Tendenz', es: 'Tendencia' },
  lastReading: {
    en: 'Last reading',
    fr: 'Dernière mesure',
    de: 'Letzte Messung',
    es: 'Última medición',
  },
  silent: {
    en: 'Silent since ',
    fr: 'Muette depuis le ',
    de: 'Still seit ',
    es: 'Sin datos desde ',
  },
  waiting: { en: 'Waiting', fr: 'En attente', de: 'Wartet', es: 'En espera' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
  source: {
    en: 'Source: Environment Agency',
    fr: 'Source : Environment Agency',
    de: 'Quelle: Environment Agency',
    es: 'Fuente: Environment Agency',
  },
  site: {
    en: 'Check for flooding',
    fr: 'Check for flooding',
    de: 'Check for flooding',
    es: 'Check for flooding',
  },
};

const t = (text, language) => text[language] ?? text.en;
const clip = (text, max = MAX_STATUS_TEXT) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const TREND_ICONS = { rising: 'trending-up', falling: 'trending-down', steady: 'minus' };
const STATE_COLORS = {
  low: WIDGET_COLORS.INFO,
  normal: WIDGET_COLORS.SUCCESS,
  high: WIDGET_COLORS.DANGER,
};
const SEVERITY_COLORS = {
  severe: WIDGET_COLORS.DANGER,
  warning: WIDGET_COLORS.DANGER,
  alert: WIDGET_COLORS.WARNING,
};

/** Colour of a station line: its state, when the reading is recent. */
function colorOf(view) {
  if (view.height === null) {
    return WIDGET_COLORS.NEUTRAL;
  }
  return STATE_COLORS[view.state] ?? WIDGET_COLORS.NEUTRAL;
}

/** The status value of a station, e.g. "4.58 m, rising" (40 characters at most). */
export function stationValue(view, language) {
  if (view.lastReadingAt === null) {
    return t(TEXT.waiting, language);
  }
  if (view.height === null) {
    return clip(`${t(TEXT.silent, language)}${formatDate(view.lastReadingAt, language)}`);
  }
  const height = formatHeight(view.height, language);
  return clip(view.trend ? `${height}, ${TREND_NAMES[language][view.trend]}` : height);
}

/** One status line per warning in force (`max` at most), or "none in force". */
function alertItems(alerts, language, max) {
  if (alerts.length === 0) {
    return [
      {
        label: t(TEXT.warnings, language),
        value: t(TEXT.noneInForce, language),
        color: WIDGET_COLORS.SUCCESS,
        icon: 'check-circle',
      },
    ];
  }
  return alerts.slice(0, max).map((alert) => {
    const key = SEVERITIES[alert.severity];
    return {
      label: clip(alert.area),
      value: clip(SEVERITY_NAMES[language][key]),
      color: SEVERITY_COLORS[key],
      icon: 'alert-triangle',
    };
  });
}

function footer(monitor, references, language, link) {
  const times = [monitor.updatedAt(references), monitor.data.alerts?.at ?? null].filter(
    (time) => time !== null,
  );
  const source = t(TEXT.source, language);
  return [
    {
      type: 'text',
      variant: 'caption',
      text: times.length === 0 ? source : `${source} · ${formatDate(Math.max(...times), language)}`,
    },
    { type: 'button', label: t(TEXT.site, language), icon: 'external-link', link: { url: link } },
  ];
}

function overview(monitor, references, language) {
  const components = [];
  const items = [];
  if (monitor.alertsEnabled() && monitor.data.alerts) {
    const alerts = monitor.alerts();
    if (alerts.length > 0) {
      const others = alerts.length > 1 ? ` (+${alerts.length - 1})` : '';
      components.push({
        type: 'text',
        variant: 'heading',
        text: clip(`${SEVERITY_NAMES[language][SEVERITIES[alerts[0].severity]]}${others}`),
      });
    }
    items.push(...alertItems(alerts, language, MAX_ALERT_ITEMS));
  }
  // One status list per widget (core budget): the warnings, then the stations.
  const views = references
    .slice(0, MAX_STATUS_ITEMS - items.length)
    .map((reference) => monitor.view(reference));
  items.push(
    ...views.map((view) => ({
      label: clip(view.name),
      value: stationValue(view, language),
      color: colorOf(view),
      icon: view.trend ? TREND_ICONS[view.trend] : 'clock',
    })),
  );
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }
  return [...components, ...footer(monitor, references, language, SITE_URL)];
}

function stationDetail(monitor, reference, language) {
  const view = monitor.view(reference);
  const ids = stationIds(monitor.gladys, reference);
  const components = [];
  if (view.has.height) {
    components.push({ type: 'value', label: t(TEXT.height, language), device_feature: ids.height });
  }
  if (view.has.flow) {
    components.push({ type: 'value', label: t(TEXT.flow, language), device_feature: ids.flow });
  }
  const items = [];
  if (view.has.state) {
    items.push({
      label: t(TEXT.state, language),
      value: view.state ? STATE_NAMES[language][view.state] : t(TEXT.unknown, language),
      color: view.state ? STATE_COLORS[view.state] : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (view.highestRecent !== null) {
    items.push({
      label: t(TEXT.highestRecent, language),
      value: formatHeight(view.highestRecent, language),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (view.has.height) {
    items.push({
      label: t(TEXT.trend, language),
      value: view.trend ? TREND_NAMES[language][view.trend] : t(TEXT.unknown, language),
      icon: view.trend ? TREND_ICONS[view.trend] : 'minus',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  items.push({
    label: t(TEXT.lastReading, language),
    value:
      view.lastReadingAt === null
        ? t(TEXT.waiting, language)
        : formatDate(view.lastReadingAt, language),
    color: view.fresh ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    icon: 'clock',
  });
  components.push({ type: 'status', items });
  const link = view.rloi ? stationPage(view.rloi) : SITE_URL;
  return [...components, ...footer(monitor, [reference], language, link)];
}

function alertsDetail(monitor, language) {
  const alerts = monitor.alerts();
  const link = alerts.length === 1 ? areaPage(alerts[0].code) : SITE_URL;
  return [
    { type: 'status', items: alertItems(alerts, language, MAX_STATUS_ITEMS) },
    ...footer(monitor, [], language, link),
  ];
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(monitor, { settings, language = 'en' }) {
      const lang = STATE_NAMES[language] ? language : 'en';
      const created = monitor.created();
      const chosen = typeof settings?.station === 'string' ? settings.station : null;
      const body = (text) => [{ type: 'text', variant: 'body', text: t(text, lang) }];
      if (chosen) {
        if (monitor.isAlertsDevice({ external_id: chosen })) {
          const components =
            monitor.alertsEnabled() && monitor.isAlertsCreated()
              ? alertsDetail(monitor, lang)
              : body(TEXT.gone);
          return { ttl_seconds: TTL_SECONDS, components };
        }
        const reference = stationRefOfId(monitor.gladys, chosen);
        const components =
          reference && created.includes(reference)
            ? stationDetail(monitor, reference, lang)
            : body(TEXT.gone);
        return { ttl_seconds: TTL_SECONDS, components };
      }
      if (created.length === 0 && !monitor.alertsEnabled()) {
        return { ttl_seconds: TTL_SECONDS, components: body(TEXT.empty) };
      }
      return { ttl_seconds: TTL_SECONDS, components: overview(monitor, created, lang) };
    },
  },
};
