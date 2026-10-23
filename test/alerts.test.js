// -----------------------------------------------------------------------------
// The flood warnings around the house, on the feed recorded on 23/10/2026: two
// flood warnings and one flood alert were in force within 10 km of a house in
// Newcastle-under-Lyme. The "Flood alerts" device, its states and the
// alert_raised / alert_lifted triggers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASHFIELD_BROOK,
  HOUSE,
  LYME_BROOK,
  STOKE_TRENT,
  captureLogs,
  create,
  createWorld,
  cycle,
  discovered,
  featureId,
} from './helpers/world.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

async function withAlerts(t, config = {}, options = {}) {
  const world = await createWorld({ config: { alerts_radius: '10', ...config }, ...options });
  t.after(() => world.app.stop());
  return world;
}

const value = (world, device, key) => world.fake.lastState(featureId(device, key));

test('the "Flood alerts" device: worst level, count and latest warning', async (t) => {
  const world = await withAlerts(t);
  const device = await create(world, 'alerts');
  assert.equal(device.name, 'Alertes crues');
  assert.deepEqual(
    device.features.map((f) => [f.external_id.split(':').pop(), f.category, f.type]),
    [
      ['severity', 'risk', 'integer'],
      ['count', 'counter-sensor', 'integer'],
      ['latest', 'text', 'text'],
    ],
  );
  assert.equal(value(world, device, 'severity'), 2, 'flood warning');
  assert.equal(value(world, device, 'count'), 3);
  assert.equal(
    value(world, device, 'latest'),
    'Alerte crue : Lyme Brook at Newcastle under Lyme and Trent Vale (23/10 13:41)',
  );
  assert.deepEqual(
    world.monitor.alerts().map((alert) => alert.code),
    [LYME_BROOK, ASHFIELD_BROOK, STOKE_TRENT],
  );
});

test('the radius is the distance to the centre of the flood area', async (t) => {
  const world = await withAlerts(t, { alerts_radius: '5' });
  assert.deepEqual(
    world.monitor.alerts().map((alert) => alert.code),
    [LYME_BROOK, ASHFIELD_BROOK],
  );
  const wide = await withAlerts(t, { alerts_radius: '50' });
  assert.equal(wide.monitor.alerts().length, 6, 'a lifted warning is not counted');
});

test('raised, escalated and lifted warnings fire one event each', async (t) => {
  const world = await withAlerts(t, { language: 'en' });
  await create(world, 'alerts');
  const now = () => world.clock.now();
  // The flood alert of the Trent becomes a flood warning, a new area is warned,
  // the Lyme Brook warning is lifted (level 4), the Ashfield Brook one leaves the feed.
  world.api.setFlood(STOKE_TRENT, 2, now(), 'River levels are rising.');
  world.api.setFlood('033FWF3FOWLEA01', 1, now(), 'Danger to life.');
  world.api.setFlood(LYME_BROOK, 4, now());
  world.api.setFlood(ASHFIELD_BROOK, null, now());
  await cycle(world, 15);
  const events = world.fake.sceneEvents.map((event) => [
    event.key,
    event.data.area_code,
    event.data.severity,
    event.data.previous_severity,
  ]);
  assert.deepEqual(events, [
    ['alert_raised', STOKE_TRENT, 'warning', 'alert'],
    ['alert_raised', '033FWF3FOWLEA01', 'severe', 'none'],
    ['alert_lifted', LYME_BROOK, 'warning', undefined],
    ['alert_lifted', ASHFIELD_BROOK, 'warning', undefined],
  ]);
  const severe = world.fake.sceneEvents[1].data;
  assert.deepEqual(severe, {
    area_code: '033FWF3FOWLEA01',
    area_name: 'Fowlea Brook at Stoke on Trent',
    river_or_sea: severe.river_or_sea,
    county: 'Stoke-on-Trent',
    severity: 'severe',
    severity_name: 'Severe flood warning',
    previous_severity: 'none',
    previous_severity_name: 'None',
    message: 'Danger to life.',
    time_raised: '23/10, 15:50',
  });
  const device = discovered(world, 'alerts');
  assert.equal(value(world, device, 'severity'), 3);
  assert.equal(value(world, device, 'count'), 2);
  assert.match(value(world, device, 'latest'), /^Severe flood warning: Fowlea Brook/);

  // Unchanged feed: nothing more. A milder level: no "raised".
  const seen = world.fake.sceneEvents.length;
  await cycle(world, 15);
  world.api.setFlood(STOKE_TRENT, 3, now());
  await cycle(world, 15);
  assert.equal(world.fake.sceneEvents.length, seen);
});

test('nothing fires on the first reading, without the device, or after a day off', async (t) => {
  const world = await withAlerts(t);
  assert.deepEqual(world.fake.sceneEvents, [], 'first reading: memory only');
  world.api.setFlood(STOKE_TRENT, 1, world.clock.now());
  await cycle(world, 15);
  assert.deepEqual(world.fake.sceneEvents, [], 'no "Flood alerts" device');
  await create(world, 'alerts');
  world.clock.advance(2 * 24 * HOUR);
  world.api.setFlood(LYME_BROOK, 1, world.clock.now());
  await cycle(world, 1);
  assert.deepEqual(world.fake.sceneEvents, [], 'memory older than a day');
  world.api.setFlood(ASHFIELD_BROOK, 1, world.clock.now());
  await cycle(world, 15);
  assert.equal(world.fake.sceneEvents.length, 1);
});

test('no warning in force: level 0 and a plain text', async (t) => {
  const world = await withAlerts(t, { language: 'de' });
  for (const code of [LYME_BROOK, ASHFIELD_BROOK, STOKE_TRENT]) {
    world.api.setFlood(code, null, world.clock.now());
  }
  await cycle(world, 15);
  const device = await create(world, 'alerts');
  assert.equal(value(world, device, 'severity'), 0);
  assert.equal(value(world, device, 'count'), 0);
  assert.equal(value(world, device, 'latest'), 'Keine Hochwasserwarnung aktiv');
});

test('the flood area list is read once, the feed at every cycle; the house is never sent', async (t) => {
  const world = await withAlerts(t);
  for (let i = 0; i < 3; i += 1) {
    await cycle(world, 15);
  }
  const paths = world.api.requests.map((url) => url.pathname.split('/').slice(-2).join('/'));
  assert.equal(paths.filter((path) => path === 'id/floodAreas').length, 1);
  assert.equal(paths.filter((path) => path === 'id/floods').length, 4);
  assert.ok(world.api.requests.every((url) => !url.search.includes(String(HOUSE.longitude))));
  assert.equal(JSON.stringify(world.monitor.data).includes(String(HOUSE.latitude)), false);
});

test('the feed unavailable: disconnected, the warnings kept, one log line', async (t) => {
  const world = await withAlerts(t);
  const device = await create(world, 'alerts');
  const lines = captureLogs(t, 'info');
  world.api.down = 503;
  await cycle(world, 15);
  await cycle(world, 15);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(value(world, device, 'count'), 3);
  assert.equal(lines.filter((line) => line.level === 'warn').length, 1);
  world.api.down = false;
  await cycle(world, 15);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.deepEqual(world.fake.sceneEvents, [], 'an outage lifts nothing');
});

test('no located house: reported, no device; radius 0: no device, no request', async (t) => {
  const world = await withAlerts(t, {}, { houses: [] });
  assert.match(world.fake.connectionStatus.message.en, /give your house a location/);
  const off = await withAlerts(t, { alerts_radius: '0' });
  assert.equal(discovered(off, 'alerts'), undefined);
  assert.deepEqual(off.api.requests, []);
});

test('a warning issued and one lifted: one info line each', async (t) => {
  const world = await withAlerts(t);
  const lines = captureLogs(t, 'info');
  world.api.setFlood(LYME_BROOK, null, world.clock.now());
  world.api.setFlood('033FWF3FOWLEA01', 3, world.clock.now());
  await cycle(world, 15);
  assert.deepEqual(
    lines.map((line) => line.text.replace(/^\[[^\]]+\] /, '')),
    [
      '[INFO] [ea-flood] Flood warning issued, alert: Fowlea Brook at Stoke on Trent (033FWF3FOWLEA01)',
      `[INFO] [ea-flood] Flood warning lifted: Lyme Brook at Newcastle under Lyme and Trent Vale (${LYME_BROOK})`,
    ],
  );
});
