# Environment Agency Flood for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that brings the
**river, tidal and groundwater levels of England** (about 4,000 stations) and the **flood
warnings in force around your house** into Gladys, from the
[real-time flood-monitoring API](https://environment.data.gov.uk/flood-monitoring/doc/reference)
of the **Environment Agency**. Public open data, no account, no key.

> **Not a flood warning service.** Data can be late, missing or wrong. In a flood, follow the
> official warnings (Environment Agency flood warnings, Floodline 0345 988 1188). Not
> affiliated with the Environment Agency.

The English counterpart of [gladys-vigicrues](https://github.com/guim31/gladys-vigicrues)
(France) and [gladys-pegelonline](https://github.com/guim31/gladys-pegelonline) (Germany).

## Features

- **One device per station**: water level in metres (stage for rivers, above Ordnance Datum for
  tidal and groundwater stations), its state against the typical range of the station (low,
  normal, high: the Gladys "liquid level state"), the highest recent level, the flow (m³/s)
  when measured and the date of the last reading. A station that stops sending says so ("No new
  reading since…") instead of showing an old value as a fresh one.
- **A "Flood alerts" device** for the area around your house: the most severe warning in force
  (Gladys risk level: 0 none, 1 flood alert, 2 flood warning, 3 severe flood warning), the
  number of warnings in force and the latest one as text.
- **Stations by reference, by name, by "Check for flooding" page or around your house** (the 3
  nearest stations that send readings, chosen inside the container from the location of your
  house in Gladys).
- **"Find stations"** in the Configuration screen: around your house, by name, river or town,
  or by reference, with the distance and current level.
- **Scene triggers**: _Flood warning issued or raised_ and _Flood warning lifted_ (with the
  level, area, river or sea, county and message), _Water level state changes_ (low, normal,
  high) and _Reference level crossed_ (typical range, highest recent level, record; rising or
  falling, with a 2 cm hysteresis on the fall). A threshold of your own stays a Gladys device
  condition on the water level.
- **Dashboard widget**: the warnings in force and the followed stations with their level, trend
  and state, or the detail of one station (live tiles) or of the flood alerts.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets and scene triggers).
- Internet access from Gladys to `environment.data.gov.uk`.
- For the flood warnings and "around my house": the location of your house in Gladys. The
  integration declares `location: true`, shown on the install screen.
- England only (Wales, Scotland and Northern Ireland have their own services).

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-ea-flood` (or install it from the catalog once it is
   listed). The install screen shows the **location** access it asks for.
2. In **Configuration**, press **Find stations**, copy the references you want into
   **Stations** (or choose **Stations around my house**), check **Flood warnings around my
   house** (10 km by default), then save.
3. Open the **Discover** tab and press **Add to Gladys** on the stations and on **Flood alerts**.

The user guide is in [`docs/en.md`](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

```
Integration container ──HTTPS──▶ environment.data.gov.uk/flood-monitoring
      │                            data/readings?latest&stationReference=…  one request per refresh
      │                            id/floods                                one request per refresh
      │                            id/stations/<ref>                        each station, once a day
      │                            id/stations, id/floodAreas               lists, once a week, if needed
      │ SDK (WebSocket + host API)
      ▼
Gladys core ── devices, states, scene events, widget
```

- Devices are published with `should_poll: false` (the core does not poll external devices
  reliably, GladysAssistant/Gladys#3198): the integration refreshes itself every 15, 20 or 30
  minutes with **one** request for the latest readings of all the followed stations and **one**
  for the flood warnings in force in England.
- The flood areas around the house are chosen once a day from the area list (their centre, in
  the container): only their codes are kept. The house coordinates never leave the container.
- Only the changes are published, plus a heartbeat every 12 hours. After 6 hours without a new
  reading the values are no longer sent: Gladys shows their real age.
- `/data/ea-flood.json` keeps the followed stations, the last readings (a few hours of levels
  for the trend), the last states and the warnings in force (so a change during a short restart
  still fires its trigger). Never the house coordinates.

## Limitations

- **Not a flood warning service.** No guarantee of delay or availability.
- **Not yet tested in a real Gladys installation: feedback welcome.** No hardware involved;
  tested against the live service and against answers recorded on 23/10/2026, when flood
  warnings were in force around Stoke-on-Trent.
- Water levels are station readings above each station datum: not comparable between stations,
  not depths.
- The distance of a warning is measured to the centre of its flood area, not to its outline.
- England only, no forecasts. 20 stations at most from the configuration (plus the ones whose
  device you created).

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test, against the SDK's fake Gladys and recorded API answers
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store validator
```

```
index.js              SDK wiring (src/app.js registers the handlers)
src/app.js            handlers → monitor, configuration action, widget
src/monitor.js        followed stations, flood warnings, refresh cycles, states, scene triggers
src/ea.js             Environment Agency client and parsing
src/http.js           GET JSON with timeout and User-Agent
src/search.js         "Find stations" action
src/devices.js        Gladys devices of a station and of the flood alerts (features, names)
src/widgets.js        dashboard widget
src/messages.js       texts sent from the container, four languages
src/geo.js            distances
src/store.js          /data persistence
src/config.js         configuration defaults and normalization
test/fixtures/        recorded Environment Agency answers (see its README)
```

Versions are bumped by the **Release** workflow (Actions → Release), never by hand.

## Credits

- Data: **Environment Agency**, real-time flood-monitoring API. Contains public sector
  information licensed under the
  [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
- Home Assistant has an equivalent integration,
  [`eafm`](https://www.home-assistant.io/integrations/eafm/) (library
  [Jc2k/aioeafm](https://github.com/Jc2k/aioeafm)); no code copied.
- The cover shows the Environment Agency logo, as published on
  [its gov.uk page](https://www.gov.uk/government/organisations/environment-agency) (SVG copy:
  [Wikipedia](https://en.wikipedia.org/wiki/File:EnvironmentAgency.svg)), drawn in white on its
  green. The logo remains the property of the Environment Agency (Crown copyright).

Not affiliated with the Environment Agency.

## License

Apache-2.0, see [LICENSE](LICENSE).
