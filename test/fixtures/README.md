# Test fixtures

- `gladys-feature-table.json`: the category/type couples, units and poll frequencies the Gladys
  core and front know (extracted from the Gladys code), used by `test/gladys-rules.test.js`.
- `ea/*-2026-10-23.json`: real answers of the Environment Agency real-time flood-monitoring API
  (`https://environment.data.gov.uk/flood-monitoring/`), recorded on 23/10/2026 around 15:45
  (London) and kept as they are (public data, Open Government Licence v3.0), reduced to what the
  tests need:
  - `stations-level`: `id/stations?parameter=level&_limit=9999`, the 35 stations within 20 km of
    the test house (Newcastle-under-Lyme) plus Kingston (Thames), Bewdley and Welsh Bridge
    (Severn), Sheerness, Queenborough and Westminster (tidal), Barton Broad and Kingston Russell
    (groundwater);
  - `station-details`: `id/stations/<reference>` for each of them, by reference;
  - `readings-latest`: `data/readings?latest&stationReference=…` for all of them;
  - `floods`: `id/floods`, the 25 flood warnings and alerts then listed in England (two flood
    warnings and a flood alert within 10 km of the test house);
  - `flood-areas`: `id/floodAreas?_limit=9999`, the 252 areas within 50 km of the test house or
    named in `floods`.

`test/helpers/world.js` serves them as the API would (`stationReference` filter, details by
reference) and lets the tests set new levels and flood warnings.
