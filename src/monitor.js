// -----------------------------------------------------------------------------
// The monitor: which stations are followed, their readings, the flood warnings
// around the house, the states published to Gladys and the scene triggers.
// Everything the SDK handlers, the action and the widget need goes through it
// (src/app.js wires it).
//
// Followed stations: the "Stations" field and "around my house" of the
// configuration (MAX_STATIONS at most), plus every station whose device the
// user created (deleting the device stops following it). Flood warnings: the
// flood areas whose centre is within "Flood warnings around my house" of the
// house, one "Flood alerts" device.
//
// Scheduling: the devices are published with should_poll: false (the core does
// not poll external devices reliably, GladysAssistant/Gladys#3198). The monitor
// runs a cycle at the configured interval: ONE request for the latest readings
// of every followed station, ONE for the flood warnings in force in England.
// The details of a station (measures, typical range) are asked once a day; the
// station list and the flood area list only when needed, kept a week in memory.
//
// States: `publishChangedStates` sends only what changed, plus a heartbeat every
// 12 hours. A reading older than 6 hours is never sent again as if it were
// fresh: the values stop, the "Last reading" feature says since when.
//
// Logs: at info, only the lifecycle (start, stations followed, a station going
// silent or coming back, a state change, a flood warning raised or lifted). A
// failure that repeats at every cycle is logged once, then at debug until it
// recovers, with one line at recovery. LOG_LEVEL=debug shows every cycle. The
// coordinates of the house are never logged nor sent: the stations and flood
// areas around it are chosen locally.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { HOME_STATIONS, MAX_STATIONS, normalizeName } from './config.js';
import {
  LIQUID_STATE,
  RISK,
  alertIds,
  buildAlertsDevice,
  buildDevice,
  capabilities,
  stationIds,
  stationRefOfId,
} from './devices.js';
import { EnvironmentAgency, LEVEL_STATES, LIFTED, MARKS, SEVERITIES } from './ea.js';
import { HttpError } from './http.js';
import { distanceKm } from './geo.js';
import {
  MARK_NAMES,
  READINGS,
  SEVERITY_NAMES,
  STATE_NAMES,
  STATUS,
  formatDate,
  join,
  labelled,
  render,
} from './messages.js';

const logger = createLogger({ name: 'ea-flood' });

export const WIDGET_KEY = 'flood';
export const TRIGGERS = {
  ALERT_RAISED: 'alert_raised',
  ALERT_LIFTED: 'alert_lifted',
  STATE_CHANGED: 'state_changed',
  MARK_CROSSED: 'mark_crossed',
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEFAULT_TIMINGS = {
  // Without a newer reading, a value is not published again as a fresh one.
  // Some stations send their readings in batches, a few hours late.
  staleAfterMs: 6 * HOUR,
  // The details of a station (measures, typical range) are asked again daily.
  stationMaxAgeMs: DAY,
  // The station and flood area lists are downloaded again after a week.
  referentialMaxAgeMs: 7 * DAY,
  // A failed download of a list is tried again after this delay.
  referentialRetryMs: HOUR,
  // The stations and flood areas around the house are chosen again once a day.
  homeMaxAgeMs: DAY,
  // A state remembered for longer fires no trigger when it changes (restart).
  memoryMs: DAY,
  // Levels kept for the trend.
  historyMs: 3 * HOUR,
  heartbeatMs: 12 * HOUR,
  // requestWidgetRefresh is rate-limited to one call every 10 s by the core.
  widgetRefreshMs: 10000,
};

// Below this rise per hour, a level is steady (m).
const STEADY_PER_HOUR = 0.01;
// A level must go this far back across a mark (m) before crossing it again
// counts: readings wobbling around the mark fire one event, not one per cycle.
const HYSTERESIS = 0.02;
// Stations asked for a fresh reading when choosing those around the house.
const HOME_CANDIDATES = 15;
// Texts of the "Latest warning" feature and of the scene variables.
const MAX_FEATURE_TEXT = 250;
const MAX_EVENT_TEXT = 1000;

const clip = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/**
 * Rising, steady or falling, from levels newest first (`{ t, v }`); null when
 * there is no level 45 minutes to 2 hours older than the newest.
 */
export function trendOf(levels) {
  const [latest] = levels;
  if (!latest) {
    return null;
  }
  const earlier = levels.find((point) => latest.t - point.t >= 45 * MINUTE);
  if (!earlier || latest.t - earlier.t > 2 * HOUR) {
    return null;
  }
  const perHour = (latest.v - earlier.v) / ((latest.t - earlier.t) / HOUR);
  if (perHour >= STEADY_PER_HOUR) {
    return 'rising';
  }
  return perHour <= -STEADY_PER_HOUR ? 'falling' : 'steady';
}

/**
 * Low, normal or high: the level compared with the typical range, with a
 * small hysteresis on the way back to normal; null without a typical range.
 */
export function stateOf(value, marks, previous = null) {
  const low = marks?.typical_low;
  const high = marks?.typical_high;
  if (low === undefined || high === undefined) {
    return null;
  }
  if (value > high || (previous === 'high' && value > high - HYSTERESIS)) {
    return 'high';
  }
  if (value < low || (previous === 'low' && value < low + HYSTERESIS)) {
    return 'low';
  }
  return 'normal';
}

/** The severity key of an alert ('severe', 'warning', 'alert'). */
const severityKey = (alert) => SEVERITIES[alert.severity];

export class Monitor {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK fake)
   * @param {object} options.store see src/store.js
   * @param {Function} [options.fetch] fetch, for the Environment Agency
   * @param {boolean} [options.timers] false: no background timer (tests drive the cycles)
   * @param {Function} [options.now] clock in ms
   * @param {object} [options.timings] overrides of DEFAULT_TIMINGS
   */
  constructor({ gladys, store, fetch: fetchImpl, timers = true, now, timings }) {
    this.gladys = gladys;
    this.store = store;
    this.api = new EnvironmentAgency({ fetch: fetchImpl });
    this.timers = timers;
    this.now = now ?? (() => Date.now());
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.config = null;
    this.data = emptyData();
    // The station and flood area lists, in memory only: { items, fetchedAt }.
    this.lists = { stations: null, areas: null };
    this.listFailedAt = { stations: -Infinity, areas: -Infinity };
    // Stations of the configuration, in order (field, then house).
    this.configured = [];
    this.problems = { unknown: [], noHouse: false, tooMany: false };
    // "Flood warnings around my house" without a located house.
    this.alertsNoHouse = false;
    this.resolved = false;
    this.lastCycleAt = -Infinity;
    this.statusMessage = undefined;
    this.cycleTimer = null;
    this.running = null;
    this.lastRefreshAt = -Infinity;
    this.refreshTimer = null;
    this.rerun = null;
    this.stopped = false;
    // Station references answered 404, with the time of the answer.
    this.notFound = new Map();
    // Keys of the failures already logged, so a repeated one is not logged again.
    this.failing = new Set();
  }

  /** Log a failure once (warn or error), then at debug until `recovered(key)`. */
  failed(key, level, message, err) {
    const details = err ? [message, err] : [message];
    if (this.failing.has(key)) {
      logger.debug(...details);
      return;
    }
    this.failing.add(key);
    logger[level](...details);
  }

  /** One line when a failure logged by `failed(key)` is over. */
  recovered(key, message) {
    if (this.failing.delete(key)) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    const saved = await this.store.load();
    if (saved?.version === 1) {
      this.data = { ...emptyData(), ...saved };
    }
    // Scheduled first: a failure below must not leave the integration without cycles.
    this.schedule();
    await this.runCycle();
    await this.publishDiscovered();
    const alerts =
      config.alertRadiusKm > 0 ? `, flood warnings within ${config.alertRadiusKm} km` : '';
    logger.info(
      `Started: ${this.followed().length} station(s) followed${alerts}, refreshed every ${config.refreshMinutes} min`,
    );
  }

  /** Reconnection: Gladys may have restarted, publish everything again. */
  async resync(config) {
    this.config = config;
    if (!this.cycleTimer) {
      this.schedule();
    }
    await this.publishDiscovered();
    this.statusMessage = undefined;
    await this.updateConnectionStatus();
    this.gladys.forgetPublishedStates?.();
    await this.publishStates(this.created(), { alerts: true });
    this.requestRefresh();
  }

  async reconfigure(config) {
    const before = this.followed().join(',');
    const radiusBefore = this.config?.alertRadiusKm;
    this.config = config;
    this.data.home = null;
    this.resolved = false;
    // A cycle already running reads the old configuration: run another one after it.
    await this.runCycle({ again: true });
    await this.publishDiscovered();
    const after = this.followed();
    if (after.join(',') !== before || config.alertRadiusKm !== radiusBefore) {
      logger.info(
        `Configuration saved: ${after.length} station(s) followed, flood warnings ${config.alertRadiusKm > 0 ? `within ${config.alertRadiusKm} km` : 'off'}`,
      );
    }
    this.schedule();
    this.requestRefresh();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.cycleTimer);
    clearTimeout(this.refreshTimer);
    this.cycleTimer = null;
    await this.running?.catch(() => {});
    await this.store.flush();
  }

  schedule() {
    if (!this.timers || this.stopped) {
      return;
    }
    clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => this.runCycle(), this.config.refreshMinutes * MINUTE);
    this.cycleTimer.unref?.();
  }

  save() {
    return this.store.save(this.data);
  }

  // --- Which stations ----------------------------------------------------------

  /** Station references whose device exists in Gladys. */
  created() {
    return [
      ...new Set(
        (this.gladys.devices ?? [])
          .map((device) => stationRefOfId(this.gladys, device.external_id))
          .filter(Boolean),
      ),
    ];
  }

  isCreated(reference) {
    const id = stationIds(this.gladys, reference).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  isAlertsCreated() {
    const id = alertIds(this.gladys).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  isAlertsDevice(device) {
    return device?.external_id === alertIds(this.gladys).device;
  }

  alertsEnabled() {
    return this.config.alertRadiusKm > 0;
  }

  /** Every followed station: the configured ones, then the created ones. */
  followed() {
    return [...new Set([...this.configured, ...this.created()])];
  }

  /** What the integration knows of a station, a created device filling the gaps. */
  station(reference) {
    const known = this.data.stations[reference];
    if (known) {
      return known;
    }
    const device = (this.gladys.devices ?? []).find(
      (item) => stationRefOfId(this.gladys, item.external_id) === reference,
    );
    if (!device) {
      return null;
    }
    const param = (name) => device.params?.find((p) => p.name === name)?.value ?? null;
    const features = new Set((device.features ?? []).map((f) => f.external_id.split(':').pop()));
    return {
      reference,
      rloi: param('RLOI_ID'),
      name: device.name ?? reference,
      river: param('RIVER'),
      town: param('TOWN'),
      level: null,
      flow: null,
      marks: {},
      has: {
        height: features.has('height'),
        state: features.has('state'),
        highest_recent: features.has('highest_recent'),
        flow: features.has('flow'),
      },
    };
  }

  /**
   * A list (`stations` or `areas`), downloaded when missing or a week old;
   * null when unavailable.
   */
  async list(kind) {
    const now = this.now();
    const current = this.lists[kind];
    const fresh = current && now - current.fetchedAt < this.timings.referentialMaxAgeMs;
    if (fresh || now - this.listFailedAt[kind] < this.timings.referentialRetryMs) {
      return current?.items ?? null;
    }
    try {
      const items =
        kind === 'stations' ? await this.api.stationList() : await this.api.floodAreas();
      this.lists[kind] = { items, fetchedAt: now };
      this.recovered(`list:${kind}`, `The ${kind} list is downloaded again`);
      logger.debug(`${kind} list: ${items.length} items`);
    } catch (err) {
      this.listFailedAt[kind] = now;
      this.failed(`list:${kind}`, 'warn', `Cannot download the ${kind} list: ${err.message}`);
    }
    return this.lists[kind]?.items ?? null;
  }

  stationList() {
    return this.list('stations');
  }

  /** The station a token of the configuration designates, from the list. */
  static find(stations, token) {
    if (token.kind === 'rloi') {
      return stations.find((station) => station.rloi === token.value) ?? null;
    }
    const wanted = normalizeName(token.value);
    if (token.kind === 'reference') {
      const station = stations.find((item) => normalizeName(item.reference) === wanted);
      if (station) {
        return station;
      }
    }
    return stations.find((station) => normalizeName(station.name) === wanted) ?? null;
  }

  /**
   * Resolve the configuration into station references. References are taken
   * as they are (their details say whether they exist); names and pages need
   * the station list. Without it, the stations found before are kept.
   */
  async resolve() {
    const problems = { unknown: [], noHouse: false, tooMany: false };
    const references = [];
    const add = (reference) => {
      if (!references.includes(reference)) {
        references.push(reference);
      }
    };
    const needList =
      this.config.homeRadiusKm > 0 ||
      this.config.stations.some((token) => token.kind !== 'reference');
    const stations = needList ? await this.stationList() : null;
    let complete = !needList || stations !== null;
    for (const token of this.config.stations) {
      const station = stations ? Monitor.find(stations, token) : null;
      if (station) {
        add(station.reference);
      } else if (token.kind === 'reference') {
        add(token.value);
      } else if (stations) {
        problems.unknown.push(token.text);
      }
    }
    if (this.config.homeRadiusKm === 0) {
      this.failing.delete('home');
    }
    if (this.config.homeRadiusKm > 0 && stations) {
      try {
        const home = await this.homeStations(stations);
        if (home === null) {
          problems.noHouse = true;
        } else {
          home.forEach(add);
        }
        this.recovered('home', 'Stations around the house chosen again');
      } catch (err) {
        complete = false;
        this.failed(
          'home',
          'warn',
          `Cannot choose the stations around the house yet: ${err.message}`,
        );
      }
    }
    if (references.length > MAX_STATIONS) {
      problems.tooMany = true;
      references.length = MAX_STATIONS;
    }
    // A failed resolution keeps the stations found before it.
    this.configured = complete ? references : [...new Set([...this.configured, ...references])];
    this.problems = complete
      ? problems
      : { ...problems, unknown: [...new Set([...this.problems.unknown, ...problems.unknown])] };
    this.resolved = complete;
    for (const name of problems.unknown) {
      this.failed(`unknown:${name}`, 'warn', `Unknown station: ${name}`);
    }
  }

  /**
   * The first house of Gladys that has a location, or null. A failure to read
   * the houses throws with `strict` (the stations are chosen again later), and
   * resolves null otherwise (the search then asks for a location).
   */
  async house({ strict = false } = {}) {
    try {
      const houses = await this.gladys.getHouses();
      return (
        houses.find(
          (house) => Number.isFinite(house.latitude) && Number.isFinite(house.longitude),
        ) ?? null
      );
    } catch (err) {
      if (strict) {
        throw new Error(`cannot read the houses of Gladys: ${err.message}`, { cause: err });
      }
      this.failed('houses', 'warn', `Cannot read the houses of Gladys: ${err.message}`);
      return null;
    }
  }

  /** Items of a list around a point, nearest first, with their distance. */
  static around(items, origin, radiusKm) {
    return items
      .filter((item) => item.latitude !== null && item.longitude !== null)
      .map((item) => ({
        item,
        km: distanceKm(origin.latitude, origin.longitude, item.latitude, item.longitude),
      }))
      .filter(({ km }) => km <= radiusKm)
      .sort((a, b) => a.km - b.km);
  }

  /**
   * The nearest stations around the house that sent a level lately
   * (HOME_STATIONS at most), chosen again once a day; null without a located
   * house.
   */
  async homeStations(stations) {
    const radius = this.config.homeRadiusKm;
    const cached = this.data.home;
    if (
      cached &&
      cached.radiusKm === radius &&
      this.now() - cached.at < this.timings.homeMaxAgeMs
    ) {
      return cached.references;
    }
    const house = await this.house({ strict: true });
    if (!house) {
      return null;
    }
    const candidates = Monitor.around(stations, house, radius)
      .slice(0, HOME_CANDIDATES)
      .map(({ item }) => item);
    const live = await this.api.readings(candidates.map((station) => station.reference));
    const references = candidates
      .filter((station) => this.isFresh(live.get(station.level.id)?.t))
      .slice(0, HOME_STATIONS)
      .map((station) => station.reference);
    // The house coordinates are not stored: only the radius and the stations.
    this.data.home = { radiusKm: radius, references, at: this.now() };
    return references;
  }

  /**
   * The codes of the flood areas around the house, chosen again once a day;
   * null without a located house. Only the codes are stored.
   */
  async alertAreas() {
    const radius = this.config.alertRadiusKm;
    const cached = this.data.areas;
    if (
      cached &&
      cached.radiusKm === radius &&
      this.now() - cached.at < this.timings.homeMaxAgeMs
    ) {
      return cached.codes;
    }
    const house = await this.house({ strict: true });
    if (!house) {
      return null;
    }
    const areas = await this.list('areas');
    if (!areas) {
      if (cached) {
        return cached.codes;
      }
      throw new Error('the flood area list is unavailable');
    }
    const codes = Monitor.around(areas, house, radius).map(({ item }) => item.code);
    this.data.areas = { radiusKm: radius, codes, at: this.now() };
    logger.debug(`Flood areas around the house: ${codes.length}`);
    return codes;
  }

  // --- Discovery and connection status -----------------------------------------

  discoveredDevices() {
    const devices = this.followed()
      .map((reference) => this.station(reference))
      .filter(Boolean)
      .map((station) => buildDevice(this.gladys, station, this.config.language));
    if (this.alertsEnabled()) {
      devices.push(buildAlertsDevice(this.gladys, this.config.alertRadiusKm, this.config.language));
    }
    return devices;
  }

  async publishDiscovered() {
    await this.gladys.publishDiscoveredDevices(this.discoveredDevices());
  }

  async updateConnectionStatus() {
    const { unknown, noHouse, tooMany } = this.problems;
    const parts = [];
    // A failed weekly download of a list is harmless while the old list serves.
    const listDown = ['stations', 'areas'].some(
      (kind) => this.failing.has(`list:${kind}`) && !this.lists[kind],
    );
    const down = this.failing.has('readings') || this.failing.has('floods');
    if (down || listDown) {
      parts.push(render(STATUS, 'down'));
    }
    if (this.failing.has('home') || this.failing.has('areas')) {
      parts.push(render(STATUS, 'homeFailed'));
    }
    if (unknown.length > 0) {
      parts.push(render(STATUS, 'unknown', { names: unknown.join(', ') }));
    }
    if (noHouse || this.alertsNoHouse) {
      parts.push(render(STATUS, 'noHouse'));
    }
    if (tooMany) {
      parts.push(render(STATUS, 'tooMany', { max: MAX_STATIONS }));
    }
    if (
      this.resolved &&
      this.followed().length === 0 &&
      !this.alertsEnabled() &&
      unknown.length === 0 &&
      !noHouse
    ) {
      parts.push(render(STATUS, 'none'));
    }
    const message = parts.length > 0 ? join(...parts) : undefined;
    const connected = !down && this.resolved;
    const key = JSON.stringify([connected, message]);
    if (key === this.statusMessage) {
      return;
    }
    this.statusMessage = key;
    await this.gladys.setConnectionStatus(connected, message).catch(() => {});
  }

  // --- Gladys events -----------------------------------------------------------

  async onDeviceCreated(device) {
    if (this.isAlertsDevice(device)) {
      await this.publishStates([], { alerts: true });
      this.requestRefresh();
      return;
    }
    const reference = stationRefOfId(this.gladys, device.external_id);
    if (!reference) {
      return;
    }
    if (!this.data.readings[reference]) {
      await this.runCycle({ again: true });
    }
    // The SDK forgot the states of the device: everything is published again.
    await this.publishStates([reference]);
    this.requestRefresh();
  }

  async onDeviceDeleted() {
    // A station only followed through its device is no longer followed.
    await this.publishDiscovered();
    this.requestRefresh();
  }

  /** onPoll fallback: should_poll is false, but a Gladys polling anyway gets an answer. */
  async poll(device) {
    const reference = stationRefOfId(this.gladys, device.external_id);
    const alerts = this.isAlertsDevice(device);
    if (!reference && !alerts) {
      return;
    }
    // Read again only if the last cycle is older than half the interval.
    if (this.now() - this.lastCycleAt >= (this.config.refreshMinutes * MINUTE) / 2) {
      await this.runCycle();
    } else {
      await this.publishStates(reference ? [reference] : [], { alerts });
    }
  }

  // --- Cycles ------------------------------------------------------------------

  /** Run a cycle; `again`: if one is running, run a new one once it is over. */
  runCycle({ again = false } = {}) {
    if (this.stopped) {
      return this.running;
    }
    if (this.running) {
      if (again) {
        this.rerun ??= this.running.then(() => {
          this.rerun = null;
          return this.runCycle();
        });
        return this.rerun;
      }
      return this.running;
    }
    this.running = this.cycle()
      .then(() => this.recovered('cycle', 'Refresh cycles work again'))
      .catch((err) => this.failed('cycle', 'error', 'Refresh cycle failed', err))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  async cycle() {
    this.lastCycleAt = this.now();
    const before = this.discoveredKey();
    // Cheap when the station list is fresh: it is downloaded once a week.
    await this.resolve();
    let references = this.followed();
    await this.refreshStations(references);
    references = this.followed();
    let changed = await this.refreshReadings(references);
    changed = (await this.refreshAlerts()) || changed;
    this.forget(references);
    if (this.discoveredKey() !== before) {
      // A refused discovery must not cost the states nor the memory of this cycle.
      await this.publishDiscovered().then(
        () => this.recovered('discovery', 'Discovered devices published again'),
        (err) => this.failed('discovery', 'warn', `Publishing the devices failed: ${err.message}`),
      );
    }
    await this.publishStates(this.created(), { alerts: true });
    await this.updateConnectionStatus();
    await this.save();
    logger.debug(`Refresh cycle: ${references.length} station(s)`);
    if (changed) {
      this.requestRefresh();
    }
  }

  discoveredKey() {
    return JSON.stringify(this.discoveredDevices());
  }

  /** Drop what is kept of the stations no longer followed (the house ones change). */
  forget(followed) {
    for (const table of [this.data.stations, this.data.readings, this.data.memory]) {
      for (const reference of Object.keys(table)) {
        if (!followed.includes(reference)) {
          delete table[reference];
        }
      }
    }
  }

  readingOf(reference) {
    this.data.readings[reference] ??= { history: [] };
    return this.data.readings[reference];
  }

  isFresh(time) {
    return typeof time === 'number' && this.now() - time <= this.timings.staleAfterMs;
  }

  /**
   * Ask the details of the stations not known yet, or known for a day. A
   * station the Environment Agency does not know (404) is reported; it stays
   * configured, a later answer may bring it back.
   */
  async refreshStations(references) {
    const unknown = [];
    for (const reference of references) {
      const known = this.data.stations[reference];
      if (known && this.now() - known.fetchedAt < this.timings.stationMaxAgeMs) {
        continue;
      }
      // A reference the service does not know is asked again once a day only.
      const missingAt = this.notFound.get(reference);
      if (missingAt !== undefined && this.now() - missingAt < this.timings.stationMaxAgeMs) {
        if (this.configured.includes(reference)) {
          unknown.push(reference);
        }
        continue;
      }
      try {
        const station = await this.api.station(reference);
        this.notFound.delete(reference);
        this.data.stations[reference] = { ...station, fetchedAt: this.now() };
        await this.foldEmbedded(reference, station);
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) {
          this.notFound.set(reference, this.now());
          if (this.configured.includes(reference)) {
            unknown.push(reference);
          }
          continue;
        }
        // Network trouble: the readings request of the cycle reports it.
        logger.debug(`Cannot read the station ${reference}: ${err.message}`);
      }
    }
    if (unknown.length > 0) {
      this.problems.unknown = [...new Set([...this.problems.unknown, ...unknown])];
      this.configured = this.configured.filter((reference) => !unknown.includes(reference));
      for (const reference of unknown) {
        this.failed(`unknown:${reference}`, 'warn', `Unknown station: ${reference}`);
      }
    }
  }

  /** The latest readings carried by the details of a station. */
  foldEmbedded(reference, station) {
    const readings = new Map();
    if (station.level && station.latest.level) {
      readings.set(station.level.id, station.latest.level);
    }
    if (station.flow && station.latest.flow) {
      readings.set(station.flow.id, station.latest.flow);
    }
    // Levels of a first reading: no event (fold only fires from a known memory).
    return this.fold(reference, readings);
  }

  /** Read the stations; resolves true when a reading changed. */
  async refreshReadings(references) {
    const known = references.filter((reference) => this.data.stations[reference]?.level);
    let changed = false;
    if (known.length === 0) {
      // Nothing to read: an old outage must not keep the status disconnected.
      this.failing.delete('readings');
    } else {
      let live;
      try {
        live = await this.api.readings(known);
        this.recovered('readings', 'The Environment Agency answers again');
      } catch (err) {
        this.failed('readings', 'warn', `Environment Agency unreachable: ${err.message}`);
        live = null;
      }
      if (live) {
        for (const reference of known) {
          changed = (await this.fold(reference, live)) || changed;
        }
      }
    }
    for (const reference of references) {
      changed = this.noteSilence(reference) || changed;
    }
    return changed;
  }

  /** Fold the latest readings of a station; fire the triggers of a new level. */
  async fold(reference, live) {
    const station = this.data.stations[reference];
    if (!station) {
      return false;
    }
    const reading = this.readingOf(reference);
    let changed = false;
    for (const [key, measure] of [
      ['level', station.level],
      ['flow', station.flow],
    ]) {
      const current = measure ? live.get(measure.id) : null;
      if (!current || current.t < (reading[key]?.t ?? -Infinity)) {
        continue;
      }
      const isNew = reading[key]?.t !== current.t;
      changed ||= isNew || reading[key]?.v !== current.v;
      reading[key] = { t: current.t, v: current.v };
      if (key !== 'level' || !isNew) {
        continue;
      }
      const state = stateOf(current.v, station.marks, reading.state ?? null);
      changed ||= state !== reading.state;
      reading.state = state;
      reading.history = [
        { t: current.t, v: current.v },
        ...(reading.history ?? []).filter(
          (point) => point.t < current.t && current.t - point.t <= this.timings.historyMs,
        ),
      ];
      // A tide rises and falls twice a day: no trend.
      const trend = station.level?.qualifier === 'Tidal Level' ? null : trendOf(reading.history);
      changed ||= trend !== reading.trend;
      reading.trend = trend;
      if (this.isFresh(current.t)) {
        await this.levelEvents(reference, station, current, state);
      }
    }
    return changed;
  }

  /** One info line when a station goes silent, one when it comes back. */
  noteSilence(reference) {
    if (!this.data.stations[reference] && !this.data.readings[reference]) {
      return false;
    }
    const reading = this.readingOf(reference);
    const silent = !this.isFresh(this.lastReadingAt(reference));
    if (silent === reading.silent) {
      return false;
    }
    const wasKnown = reading.silent !== undefined;
    reading.silent = silent;
    if (silent) {
      reading.trend = null;
    }
    const name = this.station(reference)?.name ?? reference;
    if (!wasKnown) {
      logger.debug(`${name}: ${silent ? 'no recent reading' : 'readings are fresh'}`);
    } else if (silent) {
      logger.info(`${name}: no new reading for ${this.timings.staleAfterMs / HOUR} hours`);
    } else {
      logger.info(`${name}: readings are back`);
    }
    return true;
  }

  /** Last reading time of a station (ms), or null. */
  lastReadingAt(reference) {
    const reading = this.data.readings[reference];
    const times = ['level', 'flow']
      .map((key) => reading?.[key]?.t)
      .filter((t) => typeof t === 'number');
    return times.length > 0 ? Math.max(...times) : null;
  }

  // --- Flood warnings ----------------------------------------------------------

  /**
   * Read the flood warnings in force, keep those of the areas around the house
   * and fire the triggers; resolves true when they changed. The first reading,
   * or one after a day without any, only sets the memory.
   */
  async refreshAlerts() {
    this.alertsNoHouse = false;
    if (!this.alertsEnabled()) {
      this.failing.delete('floods');
      this.failing.delete('areas');
      return false;
    }
    let codes;
    try {
      codes = await this.alertAreas();
      this.recovered('areas', 'Flood areas around the house chosen again');
    } catch (err) {
      this.failed(
        'areas',
        'warn',
        `Cannot choose the flood areas around the house yet: ${err.message}`,
      );
      return false;
    }
    if (codes === null) {
      this.alertsNoHouse = true;
      return false;
    }
    let floods;
    try {
      floods = await this.api.floods();
      this.recovered('floods', 'The flood warnings are read again');
    } catch (err) {
      this.failed('floods', 'warn', `Cannot read the flood warnings: ${err.message}`);
      return false;
    }
    const wanted = new Set(codes);
    const now = this.now();
    const memory = this.data.alerts;
    const recent = memory && now - memory.at <= this.timings.memoryMs;
    const previous = memory?.list ?? {};
    // Areas watched at the previous reading: an area entering or leaving the
    // radius (radius changed, areas chosen again) fires nothing by itself.
    const watched = new Set(memory?.codes ?? codes);
    const seen = new Map(floods.map((flood) => [flood.code, flood]));
    const current = {};
    for (const flood of floods) {
      if (wanted.has(flood.code) && flood.severity !== LIFTED) {
        current[flood.code] = flood;
      }
    }
    const events = [];
    for (const [code, before] of Object.entries(previous)) {
      if (current[code] || !wanted.has(code)) {
        continue;
      }
      // Gone from the feed without a "no longer in force": lifted only if still
      // missing at the next reading (a feed glitch lifts nothing).
      if (!seen.has(code) && !before.missing) {
        current[code] = { ...before, missing: true };
      } else if (recent) {
        events.push([TRIGGERS.ALERT_LIFTED, before, null]);
      }
    }
    if (recent) {
      for (const [code, flood] of Object.entries(current)) {
        const before = previous[code];
        if (flood.missing || !watched.has(code)) {
          continue;
        }
        if (!before || flood.severity < before.severity) {
          events.push([TRIGGERS.ALERT_RAISED, flood, before ?? null]);
        }
      }
      events.sort((a, b) => (a[0] === b[0] ? 0 : a[0] === TRIGGERS.ALERT_RAISED ? -1 : 1));
    }
    const changed = JSON.stringify(previous) !== JSON.stringify(current) || !memory;
    this.data.alerts = { at: now, codes, list: current };
    for (const [key, flood, before] of events) {
      const where = `${flood.area} (${flood.code})`;
      if (key === TRIGGERS.ALERT_LIFTED) {
        logger.info(`Flood warning lifted: ${where}`);
      } else {
        logger.info(
          `Flood warning ${before ? 'raised to' : 'issued,'} ${severityKey(flood)}: ${where}`,
        );
      }
    }
    if (events.length > 0 && this.isAlertsCreated()) {
      for (const [key, flood, before] of events) {
        await this.gladys
          .publishSceneEvent(key, this.alertEventData(key, flood, before))
          .catch((err) => logger.warn(`${key} event refused: ${err.message}`));
      }
    }
    return changed;
  }

  alertEventData(key, flood, before) {
    const language = this.config.language;
    const names = SEVERITY_NAMES[language];
    const base = {
      area_code: flood.code,
      area_name: clip(flood.area, MAX_EVENT_TEXT),
      river_or_sea: flood.riverOrSea ? clip(flood.riverOrSea, MAX_EVENT_TEXT) : null,
      county: flood.county ? clip(flood.county, MAX_EVENT_TEXT) : null,
    };
    if (key === TRIGGERS.ALERT_LIFTED) {
      return { ...base, severity: severityKey(flood), severity_name: names[severityKey(flood)] };
    }
    const previous = before ? severityKey(before) : 'none';
    return {
      ...base,
      severity: severityKey(flood),
      severity_name: names[severityKey(flood)],
      previous_severity: previous,
      previous_severity_name: names[previous],
      message: flood.message ? clip(flood.message, MAX_EVENT_TEXT) : null,
      time_raised: flood.raisedAt !== null ? formatDate(flood.raisedAt, language) : null,
    };
  }

  /** The flood warnings in force around the house, most severe then newest first. */
  alerts() {
    return Object.values(this.data.alerts?.list ?? {}).sort(
      (a, b) => a.severity - b.severity || (b.changedAt ?? 0) - (a.changedAt ?? 0),
    );
  }

  // --- Scene triggers ------------------------------------------------------------

  /**
   * Compare a new water level with what is remembered: the low / normal / high
   * state and the side of every mark. A memory older than a day (a long
   * restart) is renewed without firing anything.
   */
  async levelEvents(reference, station, current, state) {
    const memory = (this.data.memory[reference] ??= { marks: {} });
    const now = this.now();
    const recent = (entry) => entry && now - entry.at <= this.timings.memoryMs;
    const events = [];

    if (LEVEL_STATES.includes(state)) {
      const previous = memory.state;
      memory.state = { value: state, at: now };
      if (recent(previous) && previous.value !== state) {
        logger.info(`${station.name}: water level ${previous.value} -> ${state}`);
        events.push([TRIGGERS.STATE_CHANGED, { state, previous: previous.value }]);
      }
    }

    for (const mark of MARKS) {
      const value = station.marks?.[mark];
      if (value === undefined) {
        continue;
      }
      const previous = memory.marks[mark];
      let side;
      if (!recent(previous) || previous.value !== value) {
        side = current.v >= value ? 'above' : 'below';
      } else if (previous.side === 'below' && current.v >= value) {
        side = 'above';
        events.push([TRIGGERS.MARK_CROSSED, { mark, value, direction: 'rising' }]);
      } else if (previous.side === 'above' && current.v <= value - HYSTERESIS) {
        side = 'below';
        events.push([TRIGGERS.MARK_CROSSED, { mark, value, direction: 'falling' }]);
      } else {
        side = previous.side;
      }
      memory.marks[mark] = { side, value, at: now };
    }

    if (events.length === 0 || !this.isCreated(reference)) {
      return;
    }
    for (const [key, details] of events) {
      await this.gladys
        .publishSceneEvent(key, this.eventData(key, reference, station, current, details))
        .catch((err) => logger.warn(`${key} event refused: ${err.message}`));
    }
  }

  eventData(key, reference, station, current, details) {
    const language = this.config.language;
    const base = {
      station: stationIds(this.gladys, reference).device,
      station_name: station.name,
      river: station.river ?? null,
      height: current.v,
    };
    if (key === TRIGGERS.STATE_CHANGED) {
      return {
        ...base,
        state: details.state,
        state_name: STATE_NAMES[language][details.state],
        previous_state: details.previous,
        previous_state_name: STATE_NAMES[language][details.previous],
      };
    }
    return {
      ...base,
      mark: details.mark,
      mark_name: MARK_NAMES[language][details.mark],
      mark_value: details.value,
      direction: details.direction,
    };
  }

  // --- States ------------------------------------------------------------------

  /** The states of the given stations whose device exists, and of the alerts device. */
  statesOf(references, { alerts = false } = {}) {
    const states = [];
    const language = this.config.language;
    const push = (id, state) => states.push({ device_feature_external_id: id, state });
    for (const reference of references) {
      const station = this.station(reference);
      if (!station || !this.isCreated(reference)) {
        continue;
      }
      const ids = stationIds(this.gladys, reference);
      const has = capabilities(station);
      const reading = this.data.readings[reference] ?? {};
      const fresh = (key) => reading[key] && this.isFresh(reading[key].t);
      if (has.height && fresh('level')) {
        push(ids.height, reading.level.v);
        if (has.state && LEVEL_STATES.includes(reading.state)) {
          push(ids.state, LIQUID_STATE[reading.state]);
        }
      }
      if (has.highest_recent && station.marks?.highest_recent !== undefined) {
        push(ids.highest_recent, station.marks.highest_recent);
      }
      if (has.flow && fresh('flow')) {
        push(ids.flow, reading.flow.v);
      }
      const last = this.lastReadingAt(reference);
      if (last !== null) {
        const date = formatDate(last, language);
        states.push({
          device_feature_external_id: ids.last_reading,
          text: this.isFresh(last) ? date : READINGS[language].staleSince({ date }),
        });
      }
    }
    if (alerts && this.alertsEnabled() && this.isAlertsCreated() && this.data.alerts) {
      const ids = alertIds(this.gladys);
      const list = this.alerts();
      push(ids.severity, list.length > 0 ? RISK[severityKey(list[0])] : RISK.none);
      push(ids.count, list.length);
      const latest = [...list].sort((a, b) => (b.changedAt ?? 0) - (a.changedAt ?? 0))[0];
      states.push({
        device_feature_external_id: ids.latest,
        text: latest ? this.alertText(latest, language) : READINGS[language].noAlert,
      });
    }
    return states;
  }

  /** "Flood warning: Lyme Brook at Newcastle under Lyme (23/10 14:41)". */
  alertText(alert, language) {
    const date = alert.changedAt !== null ? ` (${formatDate(alert.changedAt, language)})` : '';
    const head = labelled(SEVERITY_NAMES[language][severityKey(alert)], '', language);
    return `${head}${clip(alert.area, MAX_FEATURE_TEXT - head.length - date.length)}${date}`;
  }

  async publishStates(references, options) {
    // Only the features of the devices as created: a station that gained a
    // typical range since has no feature to receive it until "Update".
    const existing = new Set(
      (this.gladys.devices ?? []).flatMap((device) =>
        (device.features ?? []).map((feature) => feature.external_id),
      ),
    );
    const states = this.statesOf(references, options).filter((state) =>
      existing.has(state.device_feature_external_id),
    );
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.recovered('publish', 'Publishing the states works again');
    } catch (err) {
      // Sent again at the next cycle (the SDK forgets what Gladys refused).
      this.failed('publish', 'warn', `Publishing the states failed: ${err.message}`);
    }
  }

  // --- Widget -------------------------------------------------------------------

  requestRefresh() {
    if (this.stopped) {
      return;
    }
    const now = this.now();
    const wait = this.lastRefreshAt + this.timings.widgetRefreshMs - now;
    if (wait <= 0) {
      this.lastRefreshAt = now;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } else if (this.timers && !this.refreshTimer) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.requestRefresh();
      }, wait);
      this.refreshTimer.unref?.();
    }
  }

  /** What the widget shows of one station. */
  view(reference) {
    const station = this.station(reference) ?? { reference, name: reference, marks: {} };
    const has = capabilities(station);
    const reading = this.data.readings[reference] ?? {};
    const last = this.lastReadingAt(reference);
    const fresh = this.isFresh(last);
    const value = (key) => (reading[key] && this.isFresh(reading[key].t) ? reading[key].v : null);
    const height = value('level');
    return {
      reference,
      rloi: station.rloi ?? null,
      name: station.name,
      river: station.river ?? null,
      has,
      height,
      flow: value('flow'),
      highestRecent: station.marks?.highest_recent ?? null,
      state: height !== null && LEVEL_STATES.includes(reading.state) ? reading.state : null,
      trend: fresh ? (reading.trend ?? null) : null,
      lastReadingAt: last,
      fresh,
    };
  }

  /** The time of the newest reading shown, for the attribution. */
  updatedAt(references) {
    const times = references
      .map((reference) => this.lastReadingAt(reference))
      .filter((t) => t !== null);
    return times.length > 0 ? Math.max(...times) : null;
  }

  // --- Search -------------------------------------------------------------------

  /** Stations matching the words (name, river, town, catchment; case and accents ignored). */
  static matches(station, words) {
    const haystack = normalizeName(
      `${station.name} ${station.river ?? ''} ${station.town ?? ''} ${station.catchment ?? ''}`,
    );
    return words.every((word) => haystack.includes(normalizeName(word)));
  }
}

function emptyData() {
  return {
    version: 1,
    stations: {},
    home: null,
    readings: {},
    memory: {},
    areas: null,
    alerts: null,
  };
}
