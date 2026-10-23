// -----------------------------------------------------------------------------
// The `flood` dashboard widget: the content fits the core vocabulary and
// budget (validateWidgetContent, empty array = rendered as sent), every bound
// feature exists on a published device, and the colours follow the state and
// the severity of the warnings.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WIDGET_COLORS, validateWidgetContent } from '@gladysassistant/integration-sdk';
import { LANGUAGES } from '../src/config.js';
import { WIDGET_KEY } from '../src/monitor.js';
import { stationValue } from '../src/widgets.js';
import {
  BEWDLEY,
  DARLASTON,
  KINGSTON,
  LYME_BROOK,
  SHEERNESS,
  create,
  createWorld,
  cycle,
} from './helpers/world.js';

async function worldWith(t, references, config = {}) {
  const world = await createWorld({ config: { stations: references.join(','), ...config } });
  t.after(() => world.app.stop());
  const devices = [];
  for (const reference of references) {
    devices.push(await create(world, reference));
  }
  return { world, devices };
}

async function content(world, settings = {}, language = 'fr') {
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings, language, units: 'metric' });
  assert.equal(ack.success, true);
  return ack.data.content;
}

const features = (devices) =>
  new Set(devices.flatMap((device) => device.features.map((feature) => feature.external_id)));

test('the overview: warnings in force, then one line per station, valid in every language', async (t) => {
  const { world } = await worldWith(t, [KINGSTON, DARLASTON, SHEERNESS], { alerts_radius: '10' });
  for (const language of LANGUAGES) {
    const widget = await content(world, {}, language);
    assert.deepEqual(validateWidgetContent(widget), [], language);
  }
  const widget = await content(world, {}, 'en');
  assert.deepEqual(widget.components[0], {
    type: 'text',
    variant: 'heading',
    text: 'Flood warning (+2)',
  });
  const items = widget.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    items.map((item) => [item.label, item.value, item.color]),
    [
      ['Lyme Brook at Newcastle under Lyme and …', 'Flood warning', WIDGET_COLORS.DANGER],
      ['Ashfield Brook at Newcastle-Under-Lyme', 'Flood warning', WIDGET_COLORS.DANGER],
      ['Stoke Trent', 'Flood alert', WIDGET_COLORS.WARNING],
      ['Kingston', '4.58 m', WIDGET_COLORS.SUCCESS],
      ['Darlaston', '1.55 m', WIDGET_COLORS.DANGER],
      ['Sheerness', '-0.78 m', WIDGET_COLORS.NEUTRAL],
    ],
  );
  assert.match(widget.components.at(-2).text, /^Source: Environment Agency · 23\/10/);
  assert.deepEqual(widget.components.at(-1).link, {
    url: 'https://check-for-flooding.service.gov.uk/alerts-and-warnings',
  });
});

test('no warning in force says so; the trend shows', async (t) => {
  const { world } = await worldWith(t, [BEWDLEY], { alerts_radius: '5' });
  for (const code of [LYME_BROOK, '033FWF3ASHFIELD']) {
    world.api.setFlood(code, null, world.clock.now());
  }
  for (const level of [0.6, 0.65, 0.7, 0.75, 0.8]) {
    world.api.setLevel(BEWDLEY, world.clock.now(), level);
    await cycle(world, 15);
  }
  const widget = await content(world, {}, 'fr');
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(widget.components[0].type, 'status', 'no heading');
  const [none, bewdley] = widget.components[0].items;
  assert.deepEqual(none, {
    label: 'Alertes crues',
    value: 'Aucune en cours',
    color: WIDGET_COLORS.SUCCESS,
    icon: 'check-circle',
  });
  assert.deepEqual(bewdley, {
    label: 'Bewdley',
    value: '0,8 m, monte',
    color: WIDGET_COLORS.SUCCESS,
    icon: 'trending-up',
  });
});

test('the detail of a station: bound tiles, state, highest recent, trend, last reading', async (t) => {
  const { world, devices } = await worldWith(t, [KINGSTON, SHEERNESS]);
  for (const language of LANGUAGES) {
    for (const device of devices) {
      const widget = await content(world, { station: device.external_id }, language);
      assert.deepEqual(validateWidgetContent(widget), [], `${language} ${device.name}`);
      for (const tile of widget.components.filter((c) => c.device_feature)) {
        assert.ok(features(devices).has(tile.device_feature), tile.device_feature);
      }
    }
  }
  const widget = await content(world, { station: devices[0].external_id }, 'fr');
  assert.deepEqual(
    widget.components.filter((c) => c.type === 'value').map((c) => c.label),
    ["Hauteur d'eau", 'Débit (m³/s)'],
  );
  assert.deepEqual(
    widget.components.find((c) => c.type === 'status').items.map((i) => [i.label, i.value]),
    [
      ['État', 'Normal'],
      ['Plus haut récent', '5,71 m'],
      ['Tendance', 'Inconnu'],
      ['Dernière mesure', '23/10 15:15'],
    ],
  );
  assert.deepEqual(widget.components.at(-1).link, {
    url: 'https://check-for-flooding.service.gov.uk/station/7267',
  });
});

test('the detail of the flood alerts lists every warning', async (t) => {
  const world = await createWorld({ config: { alerts_radius: '50' } });
  t.after(() => world.app.stop());
  const device = await create(world, 'alerts');
  for (const language of LANGUAGES) {
    const widget = await content(world, { station: device.external_id }, language);
    assert.deepEqual(validateWidgetContent(widget), [], language);
  }
  const widget = await content(world, { station: device.external_id }, 'es');
  assert.equal(widget.components[0].items.length, 6);
  assert.equal(widget.components[0].items[0].value, 'Aviso de inundación');
});

test('nothing followed yet, and a device no longer followed', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const empty = await content(world, {}, 'de');
  assert.match(empty.components[0].text, /^Noch nichts verfolgt/);
  const gone = await content(world, { station: 'ea-flood:station:nope' }, 'en');
  assert.equal(gone.components[0].text, 'This device is no longer followed.');
});

test('a status value never exceeds 40 characters', () => {
  const view = { lastReadingAt: Date.parse('2026-10-23T13:00:00Z'), height: null };
  for (const language of LANGUAGES) {
    assert.ok(stationValue(view, language).length <= 40);
  }
  assert.equal(stationValue({ lastReadingAt: null }, 'fr'), 'En attente');
});
