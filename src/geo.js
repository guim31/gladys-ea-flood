// -----------------------------------------------------------------------------
// Distances on the Earth, enough for "the stations around my house".
// -----------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;
const rad = (degrees) => (degrees * Math.PI) / 180;

/** Great-circle distance in km (haversine). */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
