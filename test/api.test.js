// -----------------------------------------------------------------------------
// The Environment Agency client and the HTTP helper, on the recorded answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, USER_AGENT, getJson } from '../src/http.js';
import {
  EnvironmentAgency,
  londonTime,
  parseFlood,
  parseReadings,
  parseStation,
  stationPage,
} from '../src/ea.js';
import {
  BEWDLEY,
  KINGSTON,
  KINGSTON_RUSSELL,
  LYME_BROOK,
  SHEERNESS,
  createApi,
  fixture,
} from './helpers/world.js';

const details = fixture('ea/station-details-2026-10-23.json');
const station = (reference) => parseStation(details[reference].items);

test('Kingston: the stage in mASD rather than the stale level in mAOD, the fresh flow', () => {
  const kingston = station(KINGSTON);
  assert.equal(kingston.name, 'Kingston');
  assert.equal(kingston.river, 'River Thames');
  assert.equal(kingston.rloi, '7267');
  assert.deepEqual(kingston.level, {
    id: '3400TH-level-stage-i-15_min-mASD',
    unit: 'mASD',
    qualifier: 'Stage',
  });
  assert.deepEqual(kingston.flow, { id: '3400TH-flow-water-i-15_min-m3_s' });
  assert.deepEqual(kingston.marks, {
    typical_low: 3.49,
    typical_high: 5.15,
    highest_recent: 5.707,
    max_on_record: 5.707,
  });
  assert.deepEqual(kingston.latest.level, { t: Date.parse('2026-10-23T14:15:00Z'), v: 4.577 });
});

test('tidal and groundwater stations: a level above Ordnance Datum, marks when given', () => {
  const sheerness = station(SHEERNESS);
  assert.equal(sheerness.level.unit, 'mAOD');
  assert.equal(sheerness.level.qualifier, 'Tidal Level');
  assert.equal(sheerness.flow, null);
  assert.deepEqual(sheerness.marks, { max_on_record: 4.1 }, 'no typical range');
  // A tide crosses its typical range twice a day: only the record is kept.
  assert.deepEqual(Object.keys(station('E21563').marks), ['max_on_record']);
  const borehole = station(KINGSTON_RUSSELL);
  assert.equal(borehole.level.qualifier, 'Groundwater');
  // Groundwater typical ranges are in mAOD, like the readings.
  assert.equal(borehole.marks.typical_low, 103.665);
  assert.equal(station(BEWDLEY).marks.typical_high, 3.3);
});

test('a river stage given only above Ordnance Datum: the stage scale shifted by the datum', () => {
  const raw = structuredClone(details[BEWDLEY].items);
  raw.measures = raw.measures.map((m) =>
    m.parameter === 'level'
      ? { ...m, unitName: 'mAOD', '@id': m['@id'].replace('mASD', 'mAOD') }
      : m,
  );
  const bewdley = parseStation(raw);
  assert.equal(bewdley.level.unit, 'mAOD');
  assert.equal(bewdley.marks.typical_high, 20.3, '3.3 + datum 17');
});

test('readings: by measure, the newest kept, a doubled value read as its first', () => {
  const readings = parseReadings([
    { measure: 'https://x/id/measures/A', dateTime: '2026-10-23T14:00:00Z', value: 1 },
    { measure: 'https://x/id/measures/A', dateTime: '2026-10-23T14:15:00Z', value: [2, 2.1] },
    { measure: 'https://x/id/measures/A', dateTime: '2026-10-23T13:45:00Z', value: 0.5 },
    { measure: 'https://x/id/measures/B', dateTime: 'nope', value: 3 },
  ]);
  assert.deepEqual([...readings], [['A', { t: Date.parse('2026-10-23T14:15:00Z'), v: 2 }]]);
});

test('flood warnings: severity, area, message, UK local times', () => {
  const raw = fixture('ea/floods-2026-10-23.json').items.find((f) => f.floodAreaID === LYME_BROOK);
  const flood = parseFlood(raw);
  assert.equal(flood.code, LYME_BROOK);
  assert.equal(flood.severity, 2);
  assert.equal(flood.area, 'Lyme Brook at Newcastle under Lyme and Trent Vale');
  assert.equal(flood.riverOrSea, 'Lyme Brook');
  assert.match(flood.message, /Flooding/);
  // 13:41:01 in London on 23/10 (BST) is 12:41:01 UTC.
  assert.equal(flood.raisedAt, Date.parse('2026-10-23T12:41:01Z'));
  assert.equal(londonTime('2026-12-01T09:00:00'), Date.parse('2026-12-01T09:00:00Z'));
  assert.equal(londonTime('2026-10-25T00:30:00'), Date.parse('2026-10-24T23:30:00Z'));
  assert.equal(londonTime('2026-10-23T14:15:00Z'), Date.parse('2026-10-23T14:15:00Z'));
  assert.equal(londonTime(''), null);
});

test('one request for the readings of several stations, none for no station', async () => {
  const api = createApi();
  const client = new EnvironmentAgency({ fetch: api.fetch });
  const readings = await client.readings([KINGSTON, BEWDLEY]);
  assert.equal(readings.get('3400TH-level-stage-i-15_min-mASD').v, 4.577);
  assert.ok(readings.has('2001-level-stage-i-15_min-mASD'));
  assert.equal(api.requests.length, 1);
  assert.deepEqual(api.requests[0].searchParams.getAll('stationReference'), [KINGSTON, BEWDLEY]);
  assert.deepEqual(await client.readings([]), new Map());
  assert.equal(api.requests.length, 1);
});

test('the lists: stations with a level, flood areas with their centre, 9999 at most', async () => {
  const api = createApi();
  const client = new EnvironmentAgency({ fetch: api.fetch });
  const stations = await client.stationList();
  assert.equal(stations.length, 35);
  assert.ok(stations.every((s) => s.level && s.reference));
  const areas = await client.floodAreas();
  assert.ok(areas.some((area) => area.code === LYME_BROOK));
  assert.ok(areas.every((area) => Number.isFinite(area.latitude)));
  assert.ok(
    api.requests.every((url) => !/_limit=\d/.test(url.search) || /_limit=9999/.test(url.search)),
  );
  const floods = await client.floods();
  assert.equal(floods.length, 25);
});

test('HTTP failures become an HttpError: status, network, timeout, not JSON', async () => {
  const answer = (status, text) => async () => ({ status, text: async () => text });
  await assert.rejects(getJson(answer(503, ''), 'https://x.test/a'), {
    name: 'HttpError',
    message: 'x.test: HTTP 503',
    status: 503,
  });
  await assert.rejects(getJson(answer(200, '<html>'), 'https://x.test/a'), {
    message: 'x.test: the answer is not JSON',
  });
  await assert.rejects(
    getJson(async () => {
      throw new TypeError('fetch failed');
    }, 'https://x.test/a'),
    { message: 'x.test: fetch failed' },
  );
  await assert.rejects(
    getJson(
      async () => {
        throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
      },
      'https://x.test/a',
      { timeoutMs: 5000 },
    ),
    (err) => err instanceof HttpError && err.message === 'x.test: no answer in 5 s',
  );
  await assert.rejects(new EnvironmentAgency({ fetch: answer(200, '{}') }).floods(), /unexpected/);
});

test('every request names the integration and asks for JSON; the page of a station', async () => {
  let headers;
  await getJson(async (url, options) => {
    headers = options.headers;
    return { status: 200, text: async () => '{}' };
  }, 'https://x.test/a');
  assert.equal(headers['User-Agent'], USER_AGENT);
  assert.equal(headers.Accept, 'application/json');
  assert.equal(stationPage('7267'), 'https://check-for-flooding.service.gov.uk/station/7267');
});
