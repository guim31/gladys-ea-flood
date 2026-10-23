// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Environment Agency API
// serving the answers recorded in test/fixtures/ea (filtered the way the real
// API filters), a manual clock, a temporary /data, and the integration wired
// on top through registerHandlers. Nothing touches the network.
// -----------------------------------------------------------------------------

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { chooseFlowMeasure, chooseLevelMeasure } from '../../src/ea.js';
import { Store } from '../../src/store.js';

process.env.LOG_LEVEL ??= 'silent';
process.env.TZ = 'Europe/London';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

const DAY = '2026-10-23';
const recorded = (name) => fixture(`ea/${name}-${DAY}.json`);

// The answers were recorded at 15:44 (London) on 23/10/2026, the latest
// readings are of 15:15 or 15:30: the clock starts at 15:50.
export const START = Date.parse('2026-10-23T14:50:00Z');

// A house in Newcastle-under-Lyme (public coordinates of the town centre),
// where flood warnings were in force on 23/10/2026.
export const HOUSE = {
  id: 'house-1',
  name: 'Home',
  selector: 'home',
  latitude: 53.0123,
  longitude: -2.2272,
};

// River Thames at Kingston: stage in mASD, typical range, flow (3 flow measures, one fresh).
export const KINGSTON = '3400TH';
export const KINGSTON_RLOI = '7267';
// River Severn at Bewdley: stage, typical range, flow.
export const BEWDLEY = '2001';
// Sheerness, tidal: level in mAOD, no typical range.
export const SHEERNESS = 'E71539';
// River Trent at Darlaston: above its typical range on 23/10/2026.
export const DARLASTON = '4083';
// The 3 stations nearest to the house that send readings.
export const NEWCASTLE = '4152';
export const LOWER_MILEHOUSE = '4661';
export const LIVERPOOL_ROAD = '4815';
// Groundwater borehole, level in mAOD.
export const KINGSTON_RUSSELL = '44239';

// Flood warnings in force within 10 km of the house on 23/10/2026.
export const LYME_BROOK = '033FWF3LYME01'; // flood warning, 0.5 km
export const ASHFIELD_BROOK = '033FWF3ASHFIELD'; // flood warning, 1.2 km
export const STOKE_TRENT = '033WAF309'; // flood alert, 6.1 km

/**
 * Fake Environment Agency. `api.down`: 'network' (connection refused), a
 * status (503) or false.
 */
export function createApi() {
  const list = recorded('stations-level');
  const details = recorded('station-details');
  const floods = recorded('floods');
  const areas = recorded('flood-areas');
  const readings = new Map(
    recorded('readings-latest').items.map((item) => [item.measure.split('/').pop(), item]),
  );
  const measuresOf = (reference) => {
    const measures = details[reference].items.measures;
    return Array.isArray(measures) ? measures : [measures];
  };
  const reading = (id, time, value) => ({
    '@id': `http://environment.data.gov.uk/flood-monitoring/data/readings/${id}/x`,
    dateTime: new Date(time).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    measure: `http://environment.data.gov.uk/flood-monitoring/id/measures/${id}`,
    value,
  });
  const iso = (time) => new Date(time).toISOString().replace(/\.\d{3}Z$/, '');

  const api = {
    details,
    floods,
    down: false,
    requests: [],

    /** A new water level (and optionally flow) of a station. */
    setLevel(reference, time, value, { flow } = {}) {
      const level = chooseLevelMeasure(measuresOf(reference)).id;
      readings.set(level, reading(level, time, value));
      if (flow !== undefined) {
        const id = chooseFlowMeasure(measuresOf(reference)).id;
        readings.set(id, reading(id, time, flow));
      }
    },

    /** A mark of the stage scale of a station. */
    mark(reference, name) {
      const scale = details[reference].items.stageScale;
      return {
        typical_low: scale.typicalRangeLow,
        typical_high: scale.typicalRangeHigh,
        highest_recent: scale.highestRecent.value,
        max_on_record: scale.maxOnRecord.value,
      }[name];
    },

    /**
     * Set a flood warning of an area: severity 1 to 4, or null to remove it
     * from the feed. Times are UK local time without offset, as the API writes them.
     */
    setFlood(code, severity, time, message = 'Flooding is expected.') {
      const items = floods.items.filter((item) => item.floodAreaID !== code);
      if (severity !== null) {
        const area = areas.items.find((item) => item.notation === code);
        const local = new Date(time).toLocaleString('sv-SE', { timeZone: 'Europe/London' });
        items.push({
          '@id': `http://environment.data.gov.uk/flood-monitoring/id/floods/${code}`,
          description: area.label,
          floodArea: { county: area.county, notation: code, riverOrSea: area.riverOrSea },
          floodAreaID: code,
          message,
          severityLevel: severity,
          timeRaised: local.replace(' ', 'T'),
          timeSeverityChanged: local.replace(' ', 'T'),
        });
      }
      floods.items = items;
      return iso(time);
    },

    answer(url) {
      const path = url.pathname.replace(/^\/flood-monitoring\//, '');
      const params = url.searchParams;
      if (path === 'id/stations') {
        return params.get('parameter') === 'level' ? list : null;
      }
      if (path.startsWith('id/stations/')) {
        return details[decodeURIComponent(path.slice('id/stations/'.length))] ?? null;
      }
      if (path === 'data/readings' && params.has('latest')) {
        const wanted = params.getAll('stationReference');
        const ids = new Set(
          wanted
            .filter((reference) => details[reference])
            .flatMap((reference) => measuresOf(reference).map((m) => m['@id'].split('/').pop())),
        );
        return {
          items: [...readings.values()].filter((item) => ids.has(item.measure.split('/').pop())),
        };
      }
      if (path === 'id/floods') {
        return floods;
      }
      if (path === 'id/floodAreas') {
        return areas;
      }
      return null;
    },

    async fetch(input) {
      const url = new URL(input);
      api.requests.push(url);
      if (api.down === 'network') {
        throw new TypeError('fetch failed');
      }
      if (api.down) {
        return { status: api.down, text: async () => 'Service Unavailable' };
      }
      const body = api.answer(url);
      if (body === null) {
        return { status: 404, text: async () => '{"error":"Not found"}' };
      }
      return { status: 200, text: async () => JSON.stringify(body) };
    },
  };
  return api;
}

/** A manual clock. */
export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config ("Flood warnings"
 *   off unless given, so the station tests stay about stations)
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {Array} [options.houses] houses of Gladys
 * @param {object} [options.api] from createApi
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] true: the monitor's own timer runs (mock it)
 */
export async function createWorld({
  config = {},
  devices = [],
  houses = [HOUSE],
  api = createApi(),
  connect = true,
  timers = false,
  clock = createClock(),
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-ea-flood-')),
} = {}) {
  const gladys = createFakeGladys({ config: { alerts_radius: '0', ...config }, devices, houses });
  const store = new Store(dataDir);
  const app = registerHandlers(gladys, {
    store,
    fetch: api.fetch,
    timers,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await app.monitor.running;
  }
  return { gladys, fake: gladys.fake, app, monitor: app.monitor, api, clock, store, dataDir };
}

/** The device published for a station reference (or 'alerts'), from the last discovery list. */
export const discovered = (world, reference) =>
  world.fake.discoveredDevices.find((device) =>
    reference === 'alerts'
      ? device.external_id === world.monitor.gladys.externalIds('alerts', 'home').device
      : device.params.some((p) => p.name === 'STATION_REFERENCE' && p.value === reference),
  );

/** Create the device of a station (or 'alerts') in Gladys, as the user would. */
export async function create(world, reference) {
  const device = discovered(world, reference);
  if (!device) {
    throw new Error(`${reference} is not in the discovered devices`);
  }
  await world.fake.deviceCreated(device);
  return device;
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`))?.external_id;

/** Run one refresh cycle, `minutes` later. */
export async function cycle(world, minutes = 15) {
  world.clock.advance(minutes * 60 * 1000);
  await world.monitor.runCycle();
}

/**
 * Capture the integration's log lines at `level` and above (LOG_LEVEL is read
 * at every call). Returns the lines as `{ level, text }`.
 */
export function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ');
    const match = /^\[[^\]]+\] \[(\w+)\]/.exec(text);
    lines.push({ level: match ? match[1].toLowerCase() : 'raw', text });
  };
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}
