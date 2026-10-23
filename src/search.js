// -----------------------------------------------------------------------------
// The "Find stations" configuration action: lists stations with their river,
// town, distance from the house and current water level, so the user can copy
// their references into the configuration.
//
// What can be typed:
//   - nothing: the stations around the house (its location in Gladys);
//   - a station reference (3400TH) or a "Check for flooding" station page;
//   - words: matched against the station, river, town and catchment names
//     ("Kingston", "Severn", "Thames Windsor"), case and accents ignored. The
//     matches are listed nearest to the house first, else by river and name.
//
// The search is made on the station list (downloaded once a week): the house
// coordinates never leave Gladys and the container.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeName, parseToken } from './config.js';
import { distanceKm } from './geo.js';
import { SEARCH, formatHeight, formatNumber, render } from './messages.js';
import { Monitor } from './monitor.js';

const logger = createLogger({ name: 'ea-flood-search' });

export const SEARCH_RADII = ['5', '10', '20', '50'];
const DEFAULT_RADIUS_KM = 10;
const MAX_RESULTS = 10;

/** Distance from the house to a station in km, null when one has no location. */
const distanceTo = (house, station) =>
  house && station.latitude !== null && station.longitude !== null
    ? distanceKm(house.latitude, house.longitude, station.latitude, station.longitude)
    : null;

/** The stations of a query with their distance, nearest first, else by river and name. */
async function candidates(monitor, text, radiusKm, stations) {
  const house = await monitor.house();
  const query = text.trim();
  if (!query) {
    return house
      ? {
          list: Monitor.around(stations, house, radiusKm).map(({ item, km }) => ({
            station: item,
            km,
          })),
        }
      : { error: 'noHouse' };
  }
  const token = parseToken(query);
  let found = [];
  if (token.kind === 'rloi') {
    found = stations.filter((station) => station.rloi === token.value);
  } else if (token.kind === 'reference') {
    const wanted = normalizeName(token.value);
    found = stations.filter((station) => normalizeName(station.reference) === wanted);
  }
  if (found.length === 0 && token.kind !== 'rloi') {
    const words = query.split(/\s+/).filter(Boolean);
    found = stations.filter((station) => Monitor.matches(station, words));
  }
  const list = found.map((station) => ({ station, km: distanceTo(house, station) }));
  // Located stations first, nearest first; then the others by river and name.
  list.sort(
    (a, b) =>
      (a.km === null) - (b.km === null) ||
      (a.km ?? 0) - (b.km ?? 0) ||
      (a.station.river ?? '').localeCompare(b.station.river ?? '') ||
      a.station.name.localeCompare(b.station.name),
  );
  return { list };
}

/**
 * Handler of the `search_stations` action.
 * @param {Monitor} monitor
 * @param {{ query?: string, radius?: string }} fields
 */
export async function searchStations(monitor, fields = {}) {
  const radiusKm = SEARCH_RADII.includes(String(fields.radius))
    ? Number(fields.radius)
    : DEFAULT_RADIUS_KM;
  try {
    const stations = await monitor.stationList();
    if (!stations) {
      return render(SEARCH, 'unavailable');
    }
    const found = await candidates(monitor, String(fields.query ?? ''), radiusKm, stations);
    if (found.error) {
      return render(SEARCH, found.error);
    }
    const total = found.list.length;
    const listed = found.list.slice(0, MAX_RESULTS);
    logger.info(`Station search: ${total} station(s) found`);
    if (listed.length === 0) {
      return render(SEARCH, 'none');
    }
    const live = await monitor.api
      .readings(listed.map(({ station }) => station.reference))
      .catch(() => null);
    return Object.fromEntries(
      Object.keys(SEARCH).map((language) => {
        const texts = SEARCH[language];
        const lines = listed.map(({ station, km }) => {
          const where = [station.river, station.town].filter(Boolean);
          const parts = [
            `${station.reference} — ${station.name}${where.length > 0 ? ` (${where.join(', ')})` : ''}`,
          ];
          if (km !== null) {
            parts.push(`${formatNumber(km, language, 1)} km`);
          }
          if (live) {
            const level = live.get(station.level.id);
            parts.push(
              level && monitor.isFresh(level.t) ? formatHeight(level.v, language) : texts.noRecent,
            );
          }
          return parts.join(', ');
        });
        return [language, `${texts.found({ count: listed.length, total })}\n${lines.join('\n')}`];
      }),
    );
  } catch (err) {
    logger.warn(`Station search failed: ${err.message}`);
    return render(SEARCH, 'unavailable');
  }
}
