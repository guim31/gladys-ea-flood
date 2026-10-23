# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One Gladys device per Environment Agency station in England: water level in metres (stage for
  rivers, above Ordnance Datum for tidal and groundwater stations), its state against the typical
  range (low, normal, high), the highest recent level, the flow (m³/s) when measured and the date
  of the last reading. A station without a new reading for 6 hours says "No new reading since…"
  instead of showing an old value as fresh.
- A "Flood alerts" device for the flood areas around the house (5 to 50 km, 10 by default): the
  most severe warning in force (risk level 0 to 3), the number of warnings in force and the
  latest one as text.
- Stations chosen by reference, name or "Check for flooding" page, or the 3 nearest stations that
  send readings around the house, chosen without sending the house location anywhere.
- "Find stations" in the Configuration screen: around the house, by name, river or town, or by
  reference, with the distance and current level.
- Scene triggers "Flood warning issued or raised", "Flood warning lifted", "Water level state
  changes" and "Reference level crossed" (typical range, highest recent level, record; rising or
  falling).
- Dashboard widget "England floods": the warnings in force and the followed stations with level,
  trend and state, or the detail of one station or of the flood alerts.
- Texts and documentation in English, French, German and Spanish.
