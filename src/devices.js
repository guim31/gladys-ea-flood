// -----------------------------------------------------------------------------
// The Gladys devices: one per followed Environment Agency station, and one
// "Flood alerts" device for the flood warnings around the house.
//
// Station features (couples checked against the Gladys front, v5.2, see
// test/gladys-rules.test.js), each only when the station offers it:
//   - height          level-sensor/liquid-depth, in m: the water level of the
//                     station as the Environment Agency gives it (stage above
//                     the gauge datum for rivers, above Ordnance Datum for the
//                     tidal and groundwater stations: the LEVEL_DATUM param);
//   - state           level-sensor/liquid-state (Gladys LIQUID_STATE: 0 low,
//                     1 normal, 2 high): the level compared with the typical
//                     range of the station, when it has one;
//   - highest_recent  level-sensor/liquid-depth, in m: the highest level of the
//                     last years (stage scale), a reference for the history;
//   - flow            water-valve/flow, in m³/s. Gladys has no m³/s unit (only
//                     m³/h): no unit, the name says it;
//   - last_reading    text/text: the date of the last reading, or "no new
//                     reading since…" once the station is silent.
//
// "Flood alerts" features:
//   - severity        risk/integer: 0 none, 1 flood alert, 2 flood warning,
//                     3 severe flood warning. The front draws a risk badge
//                     from green (0) to red (3);
//   - count           counter-sensor/integer: alerts and warnings in force;
//   - latest          text/text: the most recent one, or "none in force".
//
// Published with should_poll: false: the refresh runs in the container
// (src/monitor.js). The platform id of a station is its reference (notation),
// stable for the life of the station.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'station';
export const ALERTS_TYPE = 'alerts';
export const ALERTS_ID = 'home';
export const FEATURE_KEYS = {
  HEIGHT: 'height',
  STATE: 'state',
  HIGHEST_RECENT: 'highest_recent',
  FLOW: 'flow',
  LAST_READING: 'last_reading',
};
export const ALERT_FEATURE_KEYS = {
  SEVERITY: 'severity',
  COUNT: 'count',
  LATEST: 'latest',
};

// Gladys LIQUID_STATE values, shown "Low / Normal / High" by the front.
export const LIQUID_STATE = { low: 0, normal: 1, high: 2 };
// Gladys risk badge: 0 no risk … 3 high risk; API severity 1 is the most severe.
export const RISK = { none: 0, alert: 1, warning: 2, severe: 3 };

// Display bounds (history chart). Levels above Ordnance Datum reach a few
// hundred metres for upland groundwater boreholes.
export const HEIGHT_BOUNDS = [-100, 1000];
export const FLOW_BOUND_M3S = 5000;
// Alerts in force in one area: 50 is far above the worst floods of England.
export const COUNT_MAX = 1000;

// Feature names, frozen at creation in Gladys (language of the configuration).
export const NAMES = {
  en: {
    height: 'Water level',
    state: 'Water level state (typical range)',
    highest_recent: 'Highest recent level',
    flow: 'Flow (m³/s)',
    last_reading: 'Last reading',
    severity: 'Flood warning level',
    count: 'Warnings and alerts in force',
    latest: 'Latest warning',
  },
  fr: {
    height: "Hauteur d'eau",
    state: "État du niveau d'eau (plage habituelle)",
    highest_recent: 'Plus haut niveau récent',
    flow: 'Débit (m³/s)',
    last_reading: 'Dernière mesure',
    severity: "Niveau d'alerte crues",
    count: 'Alertes en cours',
    latest: 'Dernière alerte',
  },
  de: {
    height: 'Wasserstand',
    state: 'Wasserstandslage (üblicher Bereich)',
    highest_recent: 'Höchster Stand der letzten Jahre',
    flow: 'Abfluss (m³/s)',
    last_reading: 'Letzte Messung',
    severity: 'Hochwasser-Warnstufe',
    count: 'Aktive Warnungen',
    latest: 'Letzte Warnung',
  },
  es: {
    height: 'Nivel del agua',
    state: 'Estado del nivel (rango habitual)',
    highest_recent: 'Nivel más alto reciente',
    flow: 'Caudal (m³/s)',
    last_reading: 'Última medición',
    severity: 'Nivel de alerta de crecidas',
    count: 'Alertas en vigor',
    latest: 'Última alerta',
  },
};

export const ALERTS_NAME = {
  en: 'Flood alerts',
  fr: 'Alertes crues',
  de: 'Hochwasserwarnungen',
  es: 'Alertas de crecidas',
};

/** External ids of a station device and of its features. */
export function stationIds(gladys, reference) {
  const ids = gladys.externalIds(DEVICE_TYPE, reference);
  return {
    device: ids.device,
    ...Object.fromEntries(Object.values(FEATURE_KEYS).map((key) => [key, ids.feature(key)])),
  };
}

/** External ids of the "Flood alerts" device and of its features. */
export function alertIds(gladys) {
  const ids = gladys.externalIds(ALERTS_TYPE, ALERTS_ID);
  return {
    device: ids.device,
    ...Object.fromEntries(Object.values(ALERT_FEATURE_KEYS).map((key) => [key, ids.feature(key)])),
  };
}

/** The station reference of a device or feature external id (null if not a station). */
export function stationRefOfId(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}

/**
 * What a station offers. `station` is a parsed station (src/ea.js); a station
 * rebuilt from a Gladys device carries `has`.
 */
export function capabilities(station) {
  if (station.has) {
    return station.has;
  }
  const marks = station.marks ?? {};
  return {
    height: Boolean(station.level),
    state: Boolean(
      station.level && marks.typical_low !== undefined && marks.typical_high !== undefined,
    ),
    highest_recent: Boolean(station.level && marks.highest_recent !== undefined),
    flow: Boolean(station.flow),
  };
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

/**
 * The discovery payload of a station.
 * @param {object} gladys
 * @param {object} station see src/ea.js parseStation
 * @param {string} language language of the feature names
 */
export function buildDevice(gladys, station, language = 'fr') {
  const ids = stationIds(gladys, station.reference);
  const names = NAMES[language] ?? NAMES.fr;
  const has = capabilities(station);
  const C = DEVICE_FEATURE_CATEGORIES;
  const [min, max] = HEIGHT_BOUNDS;
  const features = [];
  if (has.height) {
    features.push(
      sensor(names.height, ids.height, C.LEVEL_SENSOR, TYPES.LEVEL_SENSOR.LIQUID_DEPTH, {
        unit: DEVICE_FEATURE_UNITS.M,
        keep_history: true,
        min,
        max,
      }),
    );
  }
  if (has.state) {
    features.push(
      sensor(names.state, ids.state, C.LEVEL_SENSOR, TYPES.LEVEL_SENSOR.LIQUID_STATE, {
        keep_history: true,
        min: 0,
        max: 2,
      }),
    );
  }
  if (has.highest_recent) {
    features.push(
      sensor(
        names.highest_recent,
        ids.highest_recent,
        C.LEVEL_SENSOR,
        TYPES.LEVEL_SENSOR.LIQUID_DEPTH,
        { unit: DEVICE_FEATURE_UNITS.M, keep_history: false, min, max },
      ),
    );
  }
  if (has.flow) {
    features.push(
      sensor(names.flow, ids.flow, C.WATER_VALVE, TYPES.WATER_VALVE.FLOW, {
        keep_history: true,
        min: -FLOW_BOUND_M3S,
        max: FLOW_BOUND_M3S,
      }),
    );
  }
  features.push(
    sensor(names.last_reading, ids.last_reading, C.TEXT, TYPES.TEXT.TEXT, {
      keep_history: false,
      min: 0,
      max: 0,
    }),
  );
  const params = [{ name: 'STATION_REFERENCE', value: station.reference }];
  for (const [name, value] of [
    ['RLOI_ID', station.rloi],
    ['RIVER', station.river],
    ['TOWN', station.town],
    ['LEVEL_DATUM', station.level?.unit],
  ]) {
    if (value) {
      params.push({ name, value: String(value) });
    }
  }
  return {
    name: station.name,
    external_id: ids.device,
    model: station.river ? `Environment Agency · ${station.river}` : 'Environment Agency',
    should_poll: false,
    params,
    features,
  };
}

/**
 * The discovery payload of the "Flood alerts" device.
 * @param {object} gladys
 * @param {number} radiusKm distance around the house
 * @param {string} language
 */
export function buildAlertsDevice(gladys, radiusKm, language = 'fr') {
  const ids = alertIds(gladys);
  const names = NAMES[language] ?? NAMES.fr;
  const C = DEVICE_FEATURE_CATEGORIES;
  return {
    name: ALERTS_NAME[language] ?? ALERTS_NAME.fr,
    external_id: ids.device,
    model: 'Environment Agency · Flood warnings',
    should_poll: false,
    params: [{ name: 'RADIUS_KM', value: String(radiusKm) }],
    features: [
      sensor(names.severity, ids.severity, C.RISK, TYPES.RISK.INTEGER, {
        keep_history: true,
        min: 0,
        max: 3,
      }),
      sensor(names.count, ids.count, C.COUNTER_SENSOR, TYPES.SENSOR.INTEGER, {
        keep_history: true,
        min: 0,
        max: COUNT_MAX,
      }),
      sensor(names.latest, ids.latest, C.TEXT, TYPES.TEXT.TEXT, {
        keep_history: false,
        min: 0,
        max: 0,
      }),
    ],
  };
}
