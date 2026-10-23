// -----------------------------------------------------------------------------
// What the integration writes to `docker logs`: at info, only the lifecycle (a
// station going silent or coming back, a state change, a flood warning, the
// start), never one
// line per refresh cycle; a failure that repeats at every cycle is logged once,
// plus one line when it is over. Never the house coordinates: the configuration
// holds no secret, the location of the home is the sensitive data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUSE, KINGSTON, captureLogs, create, createWorld, cycle } from './helpers/world.js';

const strip = (line) => line.text.replace(/^\[[^\]]+\] /, '');

async function followed(t, config = {}) {
  const world = await createWorld({
    config: { stations: KINGSTON, around_home: '10', alerts_radius: '10', ...config },
  });
  t.after(() => world.app.stop());
  await create(world, KINGSTON);
  if (world.monitor.alertsEnabled()) {
    await create(world, 'alerts');
  }
  return world;
}

test('the start is one info line', async (t) => {
  const lines = captureLogs(t, 'info');
  const world = await createWorld({ config: { stations: KINGSTON, alerts_radius: '10' } });
  t.after(() => world.app.stop());
  assert.deepEqual(lines.map(strip), [
    '[INFO] [ea-flood] Started: 1 station(s) followed, flood warnings within 10 km, refreshed every 15 min',
  ]);
});

test('a normal refresh cycle writes nothing at info', async (t) => {
  const world = await followed(t);
  const lines = captureLogs(t, 'info');
  for (let i = 0; i < 6; i += 1) {
    world.api.setLevel(KINGSTON, world.clock.now(), 4.5 + i / 100);
    await cycle(world, 15);
  }
  assert.deepEqual(lines, []);
});

test('LOG_LEVEL=debug shows the cycles, never the house coordinates', async (t) => {
  const lines = captureLogs(t, 'debug');
  const world = await followed(t);
  await cycle(world, 15);
  await cycle(world, 15);
  assert.ok(lines.filter((line) => /Refresh cycle: \d+ station/.test(line.text)).length >= 2);
  const all = lines.map((line) => line.text).join('\n');
  assert.doesNotMatch(all, new RegExp(String(HOUSE.latitude).replace('.', '\\.')));
  assert.doesNotMatch(all, new RegExp(String(HOUSE.longitude).replace('.', '\\.')));
});

test('a station going silent and coming back is one info line each', async (t) => {
  const world = await followed(t, { around_home: '0', alerts_radius: '0' });
  const lines = captureLogs(t, 'info');
  for (let i = 0; i < 26; i += 1) {
    await cycle(world, 15);
  }
  world.api.setLevel(KINGSTON, world.clock.now(), 4.6);
  await cycle(world, 15);
  assert.deepEqual(lines.map(strip), [
    '[INFO] [ea-flood] Kingston: no new reading for 6 hours',
    '[INFO] [ea-flood] Kingston: readings are back',
  ]);
});

test('a state change is one info line', async (t) => {
  const world = await followed(t, { around_home: '0', alerts_radius: '0' });
  const lines = captureLogs(t, 'info');
  world.api.setLevel(KINGSTON, world.clock.now(), 5.3);
  await cycle(world, 15);
  await cycle(world, 15);
  assert.deepEqual(lines.map(strip), ['[INFO] [ea-flood] Kingston: water level normal -> high']);
});

test('the Environment Agency down at every cycle: one warning, then one line at recovery', async (t) => {
  const world = await followed(t);
  const lines = captureLogs(t, 'info');
  world.api.down = 503;
  for (let i = 0; i < 4; i += 1) {
    await cycle(world, 15);
  }
  assert.deepEqual(
    lines.map((line) => [line.level, strip(line).replace(/^\[\w+\] /, '')]),
    [
      ['warn', '[ea-flood] Environment Agency unreachable: environment.data.gov.uk: HTTP 503'],
      ['warn', '[ea-flood] Cannot read the flood warnings: environment.data.gov.uk: HTTP 503'],
    ],
  );
  world.api.down = false;
  await cycle(world, 15);
  assert.deepEqual(lines.slice(2).map(strip), [
    '[INFO] [ea-flood] The Environment Agency answers again',
    '[INFO] [ea-flood] The flood warnings are read again',
  ]);
});

test('states refused at every cycle: one warning, then one line at recovery', async (t) => {
  const world = await followed(t, { around_home: '0', alerts_radius: '0' });
  const lines = captureLogs(t, 'info');
  const publish = t.mock.method(world.gladys, 'publishChangedStates', async () => {
    throw new Error('Gladys unreachable');
  });
  for (let i = 0; i < 3; i += 1) {
    world.api.setLevel(KINGSTON, world.clock.now(), 4.6 + i / 100);
    await cycle(world, 15);
  }
  assert.ok(publish.mock.callCount() >= 3);
  assert.deepEqual(
    lines.map((line) => [line.level, strip(line).replace(/^\[\w+\] /, '')]),
    [['warn', '[ea-flood] Publishing the states failed: Gladys unreachable']],
  );
  publish.mock.restore();
  await cycle(world, 15);
  assert.match(lines.at(-1).text, /\[INFO\].*Publishing the states works again/);
});

test('an unknown station is one warning, not one per cycle', async (t) => {
  const lines = captureLogs(t, 'info');
  const world = await createWorld({ config: { stations: 'Nowhere' } });
  t.after(() => world.app.stop());
  for (let i = 0; i < 6; i += 1) {
    await cycle(world, 30);
  }
  assert.equal(lines.filter((line) => /Unknown station: Nowhere/.test(line.text)).length, 1);
});
