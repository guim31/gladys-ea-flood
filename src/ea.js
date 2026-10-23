// -----------------------------------------------------------------------------
// Environment Agency real-time flood-monitoring API (England): keyless, no
// account. Open Government Licence v3.0.
//
//   id/stations?parameter=level&_limit=9999   the station list (~4,200), with
//                                             their measures but no reading
//   id/stations/<reference>                   one station: measures, latest
//                                             readings and stage scale
//                                             (typical range, highest recent)
//   data/readings?latest&stationReference=A&stationReference=B…
//                                             the latest reading of every
//                                             measure of the followed stations,
//                                             in ONE request per cycle
//   id/floods                                 the flood warnings and alerts in
//                                             force in England (small)
//   id/floodAreas?_limit=9999                 the flood areas (~4,200), with
//                                             the centre of each
//
// `_limit=10000` silently falls back to 500 items on id/floodAreas: 9999.
// Everything is turned into plain objects here, so the rest of the code never
// reads the API shapes.
// -----------------------------------------------------------------------------

import { getJson } from './http.js';

export const API_URL = 'https://environment.data.gov.uk/flood-monitoring';
export const SITE_URL = 'https://check-for-flooding.service.gov.uk/alerts-and-warnings';

/** The "Check for flooding" page of a station (by its RLOI id) or of a flood area. */
export const stationPage = (rloi) =>
  `https://check-for-flooding.service.gov.uk/station/${encodeURIComponent(rloi)}`;
export const areaPage = (code) =>
  `https://check-for-flooding.service.gov.uk/target-area/${encodeURIComponent(code)}`;

// Severity levels of the API, most severe first, and their keys.
export const SEVERITIES = { 1: 'severe', 2: 'warning', 3: 'alert' };
export const SEVERITY_KEYS = ['severe', 'warning', 'alert'];
export const LIFTED = 4;

// Low / normal / high: the water level compared with the typical range.
export const LEVEL_STATES = ['low', 'normal', 'high'];

// Levels of the stage scale a scene can wait for (manifest `mark_crossed`).
export const MARKS = ['typical_low', 'typical_high', 'highest_recent', 'max_on_record'];

const LIST_LIMIT = 9999;

const first = (value) => (Array.isArray(value) ? value[0] : value);
const finite = (value) => {
  const number = first(value);
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};
const text = (value) => {
  const item = first(value);
  return typeof item === 'string' && item.trim() ? item.trim() : null;
};
/** The last segment of an API URL: the notation of a measure, station or area. */
export const notationOf = (url) =>
  typeof url === 'string' ? decodeURIComponent(url.split('/').pop()) : null;

/**
 * A date of the flood warnings: written in UK local time without an offset
 * ("2026-10-23T13:41:01"). Readings carry a "Z" and are read as they are.
 */
export function londonTime(value) {
  if (typeof value !== 'string' || !value) {
    return null;
  }
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }
  const asUtc = Date.parse(`${value}Z`);
  if (!Number.isFinite(asUtc)) {
    return null;
  }
  // The offset of London at that moment (0 or +1 h), checked once more at the
  // shifted time for the hours around the clock change.
  const offset = (time) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(new Date(time))
        .map((part) => [part.type, part.value]),
    );
    const local = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return local - Math.floor(time / 1000) * 1000;
  };
  const guess = asUtc - offset(asUtc);
  return asUtc - offset(guess);
}

const QUALIFIER_RANK = ['Stage', 'Tidal Level', 'Groundwater'];

/** The water level measure of a station: stage first, a level in metres, fresh first. */
export function chooseLevelMeasure(measures) {
  const candidates = measures
    .filter((m) => m.parameter === 'level' && /^m/.test(m.unitName ?? ''))
    .map((m) => {
      const rank = QUALIFIER_RANK.indexOf(m.qualifier);
      return {
        measure: m,
        key: [
          rank === -1 ? QUALIFIER_RANK.length : rank,
          m.latestReading && typeof m.latestReading === 'object' ? 0 : 1,
          m.unitName === 'mAOD' ? 1 : 0,
        ],
      };
    })
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
  const chosen = candidates[0]?.measure;
  return chosen
    ? { id: notationOf(chosen['@id']), unit: chosen.unitName, qualifier: chosen.qualifier ?? '' }
    : null;
}

/** The flow measure of a station: fresh first, instantaneous first. */
export function chooseFlowMeasure(measures) {
  const chosen = measures
    .filter((m) => m.parameter === 'flow')
    .map((m) => ({
      measure: m,
      key: [
        m.latestReading && typeof m.latestReading === 'object' ? 0 : 1,
        m.valueType === 'instantaneous' ? 0 : 1,
      ],
    }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1])[0]?.measure;
  return chosen ? { id: notationOf(chosen['@id']) } : null;
}

const measuresOf = (raw) =>
  (Array.isArray(raw.measures) ? raw.measures : raw.measures ? [raw.measures] : []).filter(
    (m) => m && typeof m === 'object',
  );

/** A station of the list (no reading), reduced and renamed. */
export function parseStationSummary(raw) {
  return {
    reference: String(first(raw.notation) ?? first(raw.stationReference)),
    rloi: text(raw.RLOIid),
    name: text(raw.label) ?? String(first(raw.notation)),
    river: text(raw.riverName),
    town: text(raw.town),
    catchment: text(raw.catchmentName),
    latitude: finite(raw.lat),
    longitude: finite(raw.long),
    level: chooseLevelMeasure(measuresOf(raw)),
  };
}

/** The latest reading of an embedded measure, `{ t, v }`, or null. */
function embeddedReading(measures, id) {
  const measure = measures.find((m) => notationOf(m['@id']) === id);
  const latest = measure?.latestReading;
  if (!latest || typeof latest !== 'object') {
    return null;
  }
  const t = Date.parse(latest.dateTime);
  const v = finite(latest.value);
  return Number.isFinite(t) && v !== null ? { t, v } : null;
}

/** One station (id/stations/<reference>), with its stage scale and latest readings. */
export function parseStation(raw) {
  const measures = measuresOf(raw);
  const summary = parseStationSummary(raw);
  const scale = raw.stageScale && typeof raw.stageScale === 'object' ? raw.stageScale : {};
  const level = chooseLevelMeasure(measures);
  const flow = chooseFlowMeasure(measures);
  // The stage scale is in the reference of the stage: a river stage given only
  // above Ordnance Datum is compared once the datum of the gauge is added.
  const offset =
    level?.qualifier === 'Stage' && level.unit === 'mAOD' ? (finite(scale.datum) ?? 0) : 0;
  // The tide crosses its typical range twice a day: no state nor typical marks.
  const tidal = level?.qualifier === 'Tidal Level';
  const marks = {};
  const add = (key, value) => {
    if (finite(value) !== null) {
      marks[key] = Math.round((finite(value) + offset) * 1000) / 1000;
    }
  };
  if (!tidal) {
    add('typical_low', scale.typicalRangeLow);
    add('typical_high', scale.typicalRangeHigh);
    add('highest_recent', scale.highestRecent?.value);
  }
  add('max_on_record', scale.maxOnRecord?.value);
  return {
    ...summary,
    level,
    flow,
    marks,
    latest: {
      level: level ? embeddedReading(measures, level.id) : null,
      flow: flow ? embeddedReading(measures, flow.id) : null,
    },
  };
}

/** Latest readings, by measure notation: `{ t, v }`. */
export function parseReadings(items) {
  const readings = new Map();
  for (const item of items ?? []) {
    const id = notationOf(first(item.measure));
    const t = Date.parse(item.dateTime);
    const v = finite(item.value);
    if (id && Number.isFinite(t) && v !== null && t > (readings.get(id)?.t ?? -Infinity)) {
      readings.set(id, { t, v });
    }
  }
  return readings;
}

/** A flood warning or alert of id/floods. */
export function parseFlood(raw) {
  const area = raw.floodArea && typeof raw.floodArea === 'object' ? raw.floodArea : {};
  const level = Number(raw.severityLevel);
  return {
    code: String(raw.floodAreaID ?? area.notation ?? notationOf(raw['@id'])),
    severity: [1, 2, 3, 4].includes(level) ? level : null,
    area: text(raw.description) ?? text(raw.eaAreaName) ?? '',
    riverOrSea: text(area.riverOrSea),
    county: text(area.county),
    message: text(raw.message),
    raisedAt: londonTime(raw.timeRaised),
    changedAt: londonTime(raw.timeSeverityChanged) ?? londonTime(raw.timeRaised),
  };
}

export class EnvironmentAgency {
  /**
   * @param {object} [options]
   * @param {Function} [options.fetch]
   */
  constructor({ fetch: fetchImpl } = {}) {
    this.fetch = fetchImpl ?? globalThis.fetch;
  }

  async items(path, what) {
    const body = await getJson(this.fetch, `${API_URL}/${path}`);
    const items = body?.items;
    if (!items || typeof items !== 'object') {
      throw new Error(`Environment Agency: unexpected answer for ${what}`);
    }
    return items;
  }

  /** Every station measuring a water level, without readings (~4 MB). */
  async stationList() {
    const items = await this.items(`id/stations?parameter=level&_limit=${LIST_LIMIT}`, 'stations');
    if (!Array.isArray(items)) {
      throw new Error('Environment Agency: unexpected answer for the station list');
    }
    return items.map(parseStationSummary).filter((station) => station.level);
  }

  /** One station, with its stage scale and latest readings. */
  async station(reference) {
    const item = await this.items(`id/stations/${encodeURIComponent(reference)}`, reference);
    return parseStation(Array.isArray(item) ? item[0] : item);
  }

  /** The latest readings of every measure of the given stations, in one request. */
  async readings(references) {
    if (references.length === 0) {
      return new Map();
    }
    const query = references
      .map((reference) => `stationReference=${encodeURIComponent(reference)}`)
      .join('&');
    const items = await this.items(`data/readings?latest&${query}`, 'the readings');
    return parseReadings(Array.isArray(items) ? items : []);
  }

  /** The flood warnings and alerts in force (and lifted in the last 24 hours). */
  async floods() {
    const items = await this.items('id/floods', 'the flood warnings');
    return (Array.isArray(items) ? items : []).map(parseFlood).filter((flood) => flood.severity);
  }

  /** Every flood area with its centre: `{ code, name, latitude, longitude }`. */
  async floodAreas() {
    const items = await this.items(`id/floodAreas?_limit=${LIST_LIMIT}`, 'the flood areas');
    return (Array.isArray(items) ? items : [])
      .map((raw) => ({
        code: String(first(raw.notation) ?? first(raw.fwdCode)),
        name: text(raw.label) ?? '',
        latitude: finite(raw.lat),
        longitude: finite(raw.long),
      }))
      .filter((area) => area.latitude !== null && area.longitude !== null);
  }
}
