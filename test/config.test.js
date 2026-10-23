// -----------------------------------------------------------------------------
// The configuration: tokens of the "Stations" field, name comparison, defaults.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, normalizeName, parseStations } from '../src/config.js';

test('station tokens: references, API and "Check for flooding" pages, names', () => {
  const tokens = parseStations(
    '3400TH, Bewdley; E2900-southern\n' +
      'https://check-for-flooding.service.gov.uk/station/7267,' +
      'http://environment.data.gov.uk/flood-monitoring/id/stations/E71539, 3400TH, ,Kingston Russell',
  );
  assert.deepEqual(
    tokens.map(({ kind, value }) => [kind, value]),
    [
      ['reference', '3400TH'],
      ['name', 'Bewdley'],
      ['reference', 'E2900-southern'],
      ['rloi', '7267'],
      ['reference', 'E71539'],
      ['name', 'Kingston Russell'],
    ],
  );
});

test('names compare without case, accents nor punctuation', () => {
  assert.equal(normalizeName('Newcastle-Under-Lyme'), normalizeName('newcastle under lyme'));
  assert.equal(normalizeName("King's Lynn"), 'king s lynn');
});

test('defaults, and unknown values fall back to them', () => {
  assert.deepEqual(normalizeConfig({}), {
    stations: [],
    homeRadiusKm: 0,
    alertRadiusKm: 10,
    refreshMinutes: 15,
    language: DEFAULT_CONFIG.language,
  });
  const config = normalizeConfig({
    around_home: '7',
    alerts_radius: '3',
    refresh_interval: '1',
    language: 'it',
  });
  assert.deepEqual(
    [config.homeRadiusKm, config.alertRadiusKm, config.refreshMinutes, config.language],
    [0, 10, 15, 'fr'],
  );
  assert.equal(normalizeConfig({ alerts_radius: '0' }).alertRadiusKm, 0);
  assert.deepEqual(normalizeConfig(null).stations, []);
});
