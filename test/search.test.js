// -----------------------------------------------------------------------------
// The "Find stations" action, on the recorded station list.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUSE, KINGSTON, captureLogs, createWorld } from './helpers/world.js';

async function search(t, fields, options = {}) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  const ack = await world.fake.action('search_stations', fields);
  assert.equal(ack.success, true);
  return { message: ack.data.message, world };
}

test('empty: the stations around the house, nearest first, with their level', async (t) => {
  const { message } = await search(t, { radius: '5' });
  const lines = message.de.split('\n');
  assert.equal(lines[0], '5 Station(en). Kopiere die Kennungen in „Stationen“ und speichere:');
  assert.equal(lines[1], '4152 — Newcastle Under Lyme (Lyme Brook), 0,5 km, 1,15 m');
  assert.match(lines[2], /^4661 — Newcastle-Under-Lyme Lower Milehouse Lane, 1,8 km, 1,46 m$/);
});

test('the default radius is 10 km', async (t) => {
  const { message } = await search(t, {});
  assert.match(message.en, /^7 station\(s\)\./);
});

test('a river, then a river and a town; case ignored', async (t) => {
  const { message } = await search(t, { query: 'severn' }, { houses: [] });
  assert.match(message.fr, /^2 station\(s\)\./);
  assert.match(message.fr, /2001 — Bewdley \(River Severn, Bewdley\), 0,51 m/);
  const both = await search(t, { query: 'Trent Stoke' }, { houses: [] });
  assert.match(both.message.en, /^2 station\(s\)\..*\n4815 — .*\n4843 — Hanford Bridge/s);
});

test('a reference and a "Check for flooding" page', async (t) => {
  const { message } = await search(t, { query: KINGSTON });
  assert.match(
    message.en,
    /3400TH — Kingston \(River Thames, Kingston Upon Thames\), \d+[.,]\d km, 4.58 m/,
  );
  const page = await search(t, { query: 'https://check-for-flooding.service.gov.uk/station/2137' });
  assert.match(
    page.message.en,
    /^1 station\(s\)\..*\n4083 — Darlaston \(River Trent, Meaford\), 11[.,]3 km/,
  );
});

test('a stale station says so', async (t) => {
  const { message } = await search(t, { query: 'Walkmill' });
  assert.match(message.en, /4840 — Walkmill LVL, .* no recent reading/);
});

test('nothing found, no located house, the Environment Agency unavailable', async (t) => {
  assert.equal((await search(t, { query: 'Seine' })).message.en, 'No station found.');
  assert.match((await search(t, {}, { houses: [] })).message.fr, /^Votre maison n'a pas/);
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.api.down = 'network';
  const ack = await world.fake.action('search_stations', { query: 'Thames' });
  assert.match(ack.data.message.en, /Environment Agency does not answer/);
});

test('one info line per search, without the house coordinates', async (t) => {
  const lines = captureLogs(t, 'debug');
  await search(t, { radius: '5' });
  const info = lines.filter((line) => line.level === 'info').map((line) => line.text);
  assert.ok(info.some((text) => /Station search: 5 station\(s\) found/.test(text)));
  const all = lines.map((line) => line.text).join('\n');
  assert.doesNotMatch(all, new RegExp(String(HOUSE.latitude).replace('.', '\\.')));
});
