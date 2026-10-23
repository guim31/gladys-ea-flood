// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Select values are strings in the manifest (stored by Gladys as typed); the
// normalized config holds numbers.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Kilometres around the house where the nearest stations are followed; '0' = off.
export const HOME_RADII = ['0', '10', '20', '50'];

// Kilometres around the house where the flood alerts and warnings are followed
// (distance to the centre of the flood area); '0' = no "Flood alerts" device.
export const ALERT_RADII = ['0', '5', '10', '20', '50'];

// Minutes between two refreshes. Stations send a reading every 15 minutes and
// the flood warnings are updated every 15 minutes: faster would only ask the
// Environment Agency the same thing again.
export const REFRESH_INTERVALS = ['15', '20', '30'];

// Stations followed "around my house": the nearest ones that send readings.
export const HOME_STATIONS = 3;

// Upper bound of the stations taken from the configuration: one request
// covers all their readings, and the states stay far below the 300 per minute
// of the core.
export const MAX_STATIONS = 20;

export const DEFAULT_CONFIG = {
  stations: '',
  around_home: '0',
  alerts_radius: '10',
  refresh_interval: '15',
  language: 'fr',
};

// Station reference (notation) of the API: 3400TH, 2001, E71539, E2900-southern.
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;
// Pages that name a station: the API (…/id/stations/3400TH) and the "Check for
// flooding" service (…/station/7267, by its RLOI id).
const REFERENCE_IN_URL = /\/id\/stations\/([A-Za-z0-9_-]+)/;
const RLOI_IN_URL = /\/station\/(\d+)\b/;

/**
 * What one token of the "Stations" field designates: a station reference, a
 * "Check for flooding" page (RLOI id), or a name. A name may look like a
 * reference ("Kingston"): the reference is tried first, then the name.
 */
export function parseToken(token) {
  const text = String(token ?? '').trim();
  if (/^https?:\/\//i.test(text)) {
    const reference = REFERENCE_IN_URL.exec(text);
    if (reference) {
      return { kind: 'reference', value: reference[1], text };
    }
    const rloi = RLOI_IN_URL.exec(text);
    if (rloi) {
      return { kind: 'rloi', value: rloi[1], text };
    }
  }
  if (REFERENCE.test(text) && /\d/.test(text)) {
    return { kind: 'reference', value: text, text };
  }
  return { kind: 'name', value: text, text };
}

/** The tokens of the "Stations" field, duplicates removed. */
export function parseStations(text) {
  const seen = new Set();
  const tokens = [];
  for (const raw of String(text ?? '').split(/[,;\n]+/)) {
    if (!raw.trim()) {
      continue;
    }
    const token = parseToken(raw);
    const key = `${token.kind}:${normalizeName(token.value)}`;
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(token);
    }
  }
  return tokens;
}

/** A name reduced for comparison: case, accents and punctuation ignored. */
export function normalizeName(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const pick = (value, allowed, fallback) =>
  allowed.includes(String(value)) ? Number(value) : Number(fallback);

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    stations: parseStations(source.stations),
    homeRadiusKm: pick(source.around_home, HOME_RADII, DEFAULT_CONFIG.around_home),
    alertRadiusKm: pick(source.alerts_radius, ALERT_RADII, DEFAULT_CONFIG.alerts_radius),
    refreshMinutes: pick(
      source.refresh_interval,
      REFRESH_INTERVALS,
      DEFAULT_CONFIG.refresh_interval,
    ),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
