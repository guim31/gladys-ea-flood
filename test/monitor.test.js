// -----------------------------------------------------------------------------
// The monitor against the Environment Agency answers recorded on 23/10/2026:
// what is discovered and published, the internal timer, stale readings, the
// station scene triggers, failures, restarts and the configuration paths.
// The flood warnings have their own file (test/alerts.test.js).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_STATIONS } from '../src/config.js';
import { stateOf, trendOf } from '../src/monitor.js';
import {
  BEWDLEY,
  DARLASTON,
  HOUSE,
  KINGSTON,
  KINGSTON_RUSSELL,
  LIVERPOOL_ROAD,
  LOWER_MILEHOUSE,
  NEWCASTLE,
  SHEERNESS,
  START,
  create,
  createApi,
  createWorld,
  cycle,
  discovered,
  featureId,
} from './helpers/world.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const lastValue = (world, externalId) => world.fake.lastState(externalId);

async function followed(t, references, config = {}) {
  const world = await createWorld({ config: { stations: references.join(','), ...config } });
  t.after(() => world.app.stop());
  const devices = [];
  for (const reference of references) {
    devices.push(await create(world, reference));
  }
  return { world, devices };
}

test('Kingston: stage, typical range state, highest recent level, flow, last reading', async (t) => {
  const { world, devices } = await followed(t, [KINGSTON]);
  const [device] = devices;
  assert.equal(device.name, 'Kingston');
  assert.equal(device.model, 'Environment Agency · River Thames');
  assert.equal(device.should_poll, false);
  assert.deepEqual(
    device.params.map((p) => [p.name, p.value]),
    [
      ['STATION_REFERENCE', KINGSTON],
      ['RLOI_ID', '7267'],
      ['RIVER', 'River Thames'],
      ['TOWN', 'Kingston Upon Thames'],
      ['LEVEL_DATUM', 'mASD'],
    ],
  );
  assert.deepEqual(
    device.features.map((f) => [f.external_id.split(':').pop(), f.name, f.unit]),
    [
      ['height', "Hauteur d'eau", 'm'],
      ['state', "État du niveau d'eau (plage habituelle)", undefined],
      ['highest_recent', 'Plus haut niveau récent', 'm'],
      ['flow', 'Débit (m³/s)', undefined],
      ['last_reading', 'Dernière mesure', undefined],
    ],
  );
  assert.equal(lastValue(world, featureId(device, 'height')), 4.577);
  assert.equal(lastValue(world, featureId(device, 'state')), 1, 'normal');
  assert.equal(lastValue(world, featureId(device, 'highest_recent')), 5.707);
  assert.equal(lastValue(world, featureId(device, 'flow')), 30.658);
  assert.equal(lastValue(world, featureId(device, 'last_reading')), '23/10 15:15');
});

test('Sheerness (tidal) and a groundwater borehole: levels above Ordnance Datum', async (t) => {
  const { world, devices } = await followed(t, [SHEERNESS, KINGSTON_RUSSELL], { language: 'en' });
  const [sheerness, borehole] = devices;
  assert.deepEqual(
    sheerness.features.map((f) => f.name),
    ['Water level', 'Last reading'],
  );
  assert.equal(lastValue(world, featureId(sheerness, 'height')), -0.782);
  assert.deepEqual(sheerness.params.at(-1), { name: 'LEVEL_DATUM', value: 'mAOD' });
  assert.equal(lastValue(world, featureId(borehole, 'height')), 103.98);
  assert.equal(lastValue(world, featureId(borehole, 'state')), 1, 'within its typical range');
});

test('Darlaston was above its typical range on 23/10/2026', async (t) => {
  const { world, devices } = await followed(t, [DARLASTON]);
  assert.equal(lastValue(world, featureId(devices[0], 'state')), 2, 'high');
});

test('one readings request per cycle for every station, by the internal timer', async (t) => {
  const timers = t.mock.timers;
  timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const world = await createWorld({
    config: { stations: [KINGSTON, BEWDLEY, SHEERNESS].join(',') },
    timers: true,
  });
  t.after(() => world.app.stop());
  await create(world, KINGSTON);
  world.api.requests.length = 0;
  world.clock.advance(15 * MINUTE);
  world.api.setLevel(KINGSTON, world.clock.now(), 4.7);
  timers.tick(15 * MINUTE);
  await world.monitor.running;
  assert.equal(world.api.requests.length, 1, 'references only: no list, details known');
  assert.deepEqual(
    world.api.requests[0].searchParams.getAll('stationReference').sort(),
    [KINGSTON, BEWDLEY, SHEERNESS].sort(),
  );
  assert.equal(lastValue(world, featureId(discovered(world, KINGSTON), 'height')), 4.7);
});

test('the details of a station are asked again after a day', async (t) => {
  const { world, devices } = await followed(t, [KINGSTON]);
  world.api.details[KINGSTON].items.stageScale.highestRecent.value = 5.9;
  await cycle(world, 60);
  assert.equal(lastValue(world, featureId(devices[0], 'highest_recent')), 5.707);
  await cycle(world, 24 * 60);
  assert.equal(lastValue(world, featureId(devices[0], 'highest_recent')), 5.9);
});

test('only the changes are published, and a stable value again after 12 hours', async (t) => {
  // The SDK dates its memory of the published states with Date.now().
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const { world, devices } = await followed(t, [KINGSTON]);
  const height = featureId(devices[0], 'height');
  const count = () =>
    world.fake.states.filter((s) => s.device_feature_external_id === height).length;
  const before = count();
  for (let i = 0; i < 47; i += 1) {
    t.mock.timers.tick(15 * MINUTE);
    world.api.setLevel(KINGSTON, world.clock.now() + 15 * MINUTE, 4.577);
    await cycle(world, 15);
  }
  assert.equal(count(), before, 'same value at a new time: nothing sent before 12 hours');
  t.mock.timers.tick(15 * MINUTE);
  world.api.setLevel(KINGSTON, world.clock.now() + 15 * MINUTE, 4.577);
  await cycle(world, 15);
  assert.equal(count(), before + 1, 'heartbeat');
  world.api.setLevel(KINGSTON, world.clock.now(), 4.6);
  await cycle(world, 1);
  assert.equal(count(), before + 2, 'a change');
});

test('a reading growing old: the values stop, "Last reading" says since when', async (t) => {
  const { world, devices } = await followed(t, [KINGSTON]);
  const heights = () =>
    world.fake.states.filter(
      (s) => s.device_feature_external_id === featureId(devices[0], 'height'),
    ).length;
  const before = heights();
  for (let i = 0; i < 25; i += 1) {
    await cycle(world, 15);
  }
  assert.equal(heights(), before, 'no stale value sent as fresh');
  assert.equal(
    lastValue(world, featureId(devices[0], 'last_reading')),
    'Pas de nouvelle mesure depuis le 23/10 15:15',
  );
});

test('the trend compares the level with the one of about an hour before', () => {
  const at = (minutes, v) => ({ t: minutes * MINUTE, v });
  assert.equal(trendOf([at(60, 1.1), at(45, 1.05), at(0, 1)]), 'rising');
  assert.equal(trendOf([at(60, 0.9), at(0, 1)]), 'falling');
  assert.equal(trendOf([at(60, 1.005), at(0, 1)]), 'steady');
  assert.equal(trendOf([at(60, 1), at(30, 1)]), null, 'too short');
  assert.equal(trendOf([at(300, 1), at(0, 1)]), null, 'too old');
  assert.equal(trendOf([]), null);
});

test('the state compares the level with the typical range, with a hysteresis back', () => {
  const marks = { typical_low: 0.2, typical_high: 3.3 };
  assert.equal(stateOf(1, marks), 'normal');
  assert.equal(stateOf(3.31, marks), 'high');
  assert.equal(stateOf(3.29, marks, 'high'), 'high', 'within the hysteresis');
  assert.equal(stateOf(3.28, marks, 'high'), 'normal');
  assert.equal(stateOf(0.19, marks), 'low');
  assert.equal(stateOf(0.21, marks, 'low'), 'low');
  assert.equal(stateOf(1, { typical_high: 3.3 }), null, 'no typical range');
});

test('state and mark triggers: one event per transition', async (t) => {
  const { world, devices } = await followed(t, [BEWDLEY], { language: 'de' });
  const station = devices[0].external_id;
  const high = world.api.mark(BEWDLEY, 'typical_high');
  const now = () => world.clock.now();
  world.api.setLevel(BEWDLEY, now(), high + 0.1);
  await cycle(world, 15);
  // Wobbling around the top of the range: no new event until it really falls.
  world.api.setLevel(BEWDLEY, now(), high - 0.01);
  await cycle(world, 15);
  world.api.setLevel(BEWDLEY, now(), high + 0.01);
  await cycle(world, 15);
  world.api.setLevel(BEWDLEY, now(), high - 0.05);
  await cycle(world, 15);
  const events = world.fake.sceneEvents.map((event) => [
    event.key,
    event.data.state ?? event.data.mark,
    event.data.direction ?? event.data.previous_state,
  ]);
  assert.deepEqual(events, [
    ['state_changed', 'high', 'normal'],
    ['mark_crossed', 'typical_high', 'rising'],
    ['state_changed', 'normal', 'high'],
    ['mark_crossed', 'typical_high', 'falling'],
  ]);
  assert.deepEqual(world.fake.sceneEvents[0].data, {
    station,
    station_name: 'Bewdley',
    river: 'River Severn',
    height: high + 0.1,
    state: 'high',
    state_name: 'Hoch',
    previous_state: 'normal',
    previous_state_name: 'Normal',
  });
  assert.equal(world.fake.sceneEvents[1].data.mark_name, 'Obergrenze des üblichen Bereichs');
  assert.equal(world.fake.sceneEvents[1].data.mark_value, high);

  const seen = world.fake.sceneEvents.length;
  world.api.setLevel(BEWDLEY, now(), world.api.mark(BEWDLEY, 'max_on_record') + 0.1);
  await cycle(world, 15);
  assert.deepEqual(
    world.fake.sceneEvents
      .slice(seen)
      .filter((event) => event.key === 'mark_crossed')
      .map((event) => event.data.mark)
      .sort(),
    ['highest_recent', 'max_on_record', 'typical_high'],
  );
});

test('no trigger without a created device, nor for a stale reading or the first one', async (t) => {
  const world = await createWorld({ config: { stations: BEWDLEY } });
  t.after(() => world.app.stop());
  world.api.setLevel(BEWDLEY, world.clock.now(), 4);
  await cycle(world, 15);
  assert.deepEqual(world.fake.sceneEvents, [], 'no device');
  await create(world, BEWDLEY);
  world.api.setLevel(BEWDLEY, world.clock.now() - 7 * HOUR, 0.1);
  await cycle(world, 15);
  assert.deepEqual(world.fake.sceneEvents, [], 'stale');
});

test('the states remembered survive a restart; a day-old memory fires nothing', async (t) => {
  const api = createApi();
  const first = await createWorld({ api, config: { stations: BEWDLEY } });
  const device = await create(first, BEWDLEY);
  await first.app.stop();
  const second = await createWorld({
    api,
    config: { stations: BEWDLEY },
    devices: [device],
    dataDir: first.dataDir,
    clock: first.clock,
  });
  t.after(() => second.app.stop());
  api.setLevel(BEWDLEY, second.clock.now(), 4);
  await cycle(second, 15);
  assert.ok(second.fake.sceneEvents.some((event) => event.key === 'state_changed'));

  const third = await createWorld({
    api,
    config: { stations: BEWDLEY },
    devices: [device],
    dataDir: first.dataDir,
    clock: first.clock,
  });
  t.after(() => third.app.stop());
  third.clock.advance(2 * 24 * HOUR);
  api.setLevel(BEWDLEY, third.clock.now(), 0.5);
  await cycle(third, 1);
  assert.deepEqual(third.fake.sceneEvents, []);
});

test('references, names (any case) and pages resolve through the station list', async (t) => {
  const world = await createWorld({
    config: {
      stations: `${KINGSTON}; bewdley, NEWCASTLE UNDER LYME\nhttps://check-for-flooding.service.gov.uk/station/2137, Nowhere`,
    },
  });
  t.after(() => world.app.stop());
  assert.deepEqual(world.monitor.followed(), [KINGSTON, BEWDLEY, NEWCASTLE, DARLASTON]);
  const status = world.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.match(status.message.fr, /Station inconnue : Nowhere/);
  assert.equal(world.api.requests.filter((u) => u.pathname.endsWith('/id/stations')).length, 1);
});

test('an unknown reference is reported, without the station list', async (t) => {
  const world = await createWorld({ config: { stations: 'ZZ9999' } });
  t.after(() => world.app.stop());
  assert.match(world.fake.connectionStatus.message.en, /Unknown station: ZZ9999/);
  assert.deepEqual(world.fake.discoveredDevices, []);
  assert.equal(world.api.requests.filter((u) => u.pathname.endsWith('/id/stations')).length, 0);
});

test('the Environment Agency unavailable: disconnected status, then back', async (t) => {
  const { world } = await followed(t, [KINGSTON]);
  world.api.down = 503;
  await cycle(world, 15);
  let status = world.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.de, /Die Environment Agency antwortet nicht/);
  world.api.down = false;
  await cycle(world, 15);
  status = world.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.equal(status.message, undefined);
});

test('"around my house" adds the 3 nearest stations that send readings', async (t) => {
  const world = await createWorld({ config: { around_home: '10' } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.monitor.followed(), [NEWCASTLE, LOWER_MILEHOUSE, LIVERPOOL_ROAD]);
  assert.ok(
    world.api.requests.every((url) => !url.search.includes(String(HOUSE.latitude))),
    'the house location is never sent',
  );
});

test('"around my house" without a located house is reported', async (t) => {
  const world = await createWorld({ config: { around_home: '20' }, houses: [] });
  t.after(() => world.app.stop());
  assert.match(world.fake.connectionStatus.message.fr, /Autour de ma maison/);
});

test('an empty configuration says what to do, and asks nothing', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.match(world.fake.connectionStatus.message.en, /No station yet/);
  assert.deepEqual(world.api.requests, []);
});

test(`the configuration follows ${MAX_STATIONS} stations at most`, async (t) => {
  const references = createApi()
    .answer(new URL('https://environment.data.gov.uk/flood-monitoring/id/stations?parameter=level'))
    .items.map((s) => s.notation);
  const world = await createWorld({ config: { stations: references.join(',') } });
  t.after(() => world.app.stop());
  assert.equal(world.monitor.followed().length, MAX_STATIONS);
  assert.match(world.fake.connectionStatus.message.en, /first 20 stations/);
});

test('a created device stays followed once removed from the configuration', async (t) => {
  const { world } = await followed(t, [KINGSTON]);
  await world.fake.configUpdated({ stations: '', alerts_radius: '0' });
  await world.monitor.running;
  assert.deepEqual(world.monitor.followed(), [KINGSTON]);
  assert.ok(discovered(world, KINGSTON));
});

test('a created device gets all its states at once, and the widget is refreshed', async (t) => {
  const world = await createWorld({ config: { stations: KINGSTON } });
  t.after(() => world.app.stop());
  const refreshes = world.fake.widgetRefreshes.length;
  world.clock.advance(MINUTE);
  const device = await create(world, KINGSTON);
  assert.equal(lastValue(world, featureId(device, 'height')), 4.577);
  assert.ok(world.fake.widgetRefreshes.length > refreshes);
});

test('a reconnection publishes the devices and every state again', async (t) => {
  const { world, devices } = await followed(t, [KINGSTON]);
  const before = world.fake.states.length;
  await world.gladys.disconnect();
  await world.gladys.connect();
  assert.equal(world.fake.states.length, before * 2);
  assert.equal(world.fake.discoveredDevices[0].external_id, devices[0].external_id);
});

test('onPoll, should a Gladys call it: reads again only when the cycle is old', async (t) => {
  const { world, devices } = await followed(t, [KINGSTON]);
  const requests = world.api.requests.length;
  await world.fake.poll(devices[0]);
  assert.equal(world.api.requests.length, requests);
  world.clock.advance(10 * MINUTE);
  await world.fake.poll(devices[0]);
  assert.equal(world.api.requests.length, requests + 1);
});

test('a device update publishes its states again', async (t) => {
  const { world, devices } = await followed(t, [KINGSTON]);
  const before = world.fake.states.length;
  world.gladys.forgetPublishedStates?.();
  await world.fake.deviceUpdated(devices[0]);
  assert.ok(world.fake.states.length > before);
});

test('a configuration saved during a cycle is applied right after it', async (t) => {
  const world = await createWorld({ config: { stations: KINGSTON } });
  t.after(() => world.app.stop());
  const running = world.monitor.runCycle();
  const saved = world.fake.configUpdated({
    stations: `${KINGSTON}, ${BEWDLEY}`,
    alerts_radius: '0',
  });
  await running;
  await saved;
  await world.monitor.rerun;
  assert.deepEqual(world.monitor.followed(), [KINGSTON, BEWDLEY]);
  assert.ok(discovered(world, BEWDLEY));
});

test('a failed start keeps the internal timer', async (t) => {
  const timers = t.mock.timers;
  timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const fail = { on: true };
  const world = await createWorld({ config: { stations: KINGSTON }, timers: true, connect: false });
  t.after(() => world.app.stop());
  const publish = world.gladys.publishDiscoveredDevices.bind(world.gladys);
  t.mock.method(world.gladys, 'publishDiscoveredDevices', async (devices) => {
    if (fail.on) {
      throw new Error('HTTP 503');
    }
    return publish(devices);
  });
  await world.gladys.connect();
  await world.app.ready;
  assert.ok(world.monitor.cycleTimer, 'scheduled despite the failure');
  fail.on = false;
  const requests = world.api.requests.length;
  world.clock.advance(15 * MINUTE);
  timers.tick(15 * MINUTE);
  await world.monitor.running;
  assert.equal(world.api.requests.length, requests + 1);
});

test('the stations no longer followed are forgotten in /data', async (t) => {
  const world = await createWorld({ config: { stations: `${KINGSTON}, ${BEWDLEY}` } });
  t.after(() => world.app.stop());
  assert.ok(world.monitor.data.readings[BEWDLEY]);
  await world.fake.configUpdated({ stations: KINGSTON, alerts_radius: '0' });
  await world.monitor.running;
  assert.equal(world.monitor.data.readings[BEWDLEY], undefined);
  assert.equal(world.monitor.data.stations[BEWDLEY], undefined);
  assert.ok(world.monitor.data.readings[KINGSTON]);
});

test('the houses of Gladys unreadable: no "give your house a location", tried again', async (t) => {
  const world = await createWorld({ config: { around_home: '10' }, connect: false });
  t.after(() => world.app.stop());
  const houses = t.mock.method(world.gladys, 'getHouses', async () => {
    throw new Error('HTTP 500');
  });
  await world.gladys.connect();
  await world.app.ready;
  await world.monitor.running;
  const status = world.fake.connectionStatus;
  assert.doesNotMatch(status.message.en, /give your house a location/);
  assert.match(status.message.en, /cannot be chosen yet/);
  houses.mock.restore();
  await cycle(world, 15);
  assert.deepEqual(world.monitor.followed(), [NEWCASTLE, LOWER_MILEHOUSE, LIVERPOOL_ROAD]);
  assert.equal(world.fake.connectionStatus.connected, true);
});
