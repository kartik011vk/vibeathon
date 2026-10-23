// Straight-line (great-circle) distance. This is NOT road distance and says nothing about route safety.
export function haversineKm(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(isValidCoord)) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)) * 10) / 10;
}

function isValidCoord(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function hasCoords(obj, latKey = 'latitude', lngKey = 'longitude') {
  return obj != null && isValidCoord(obj[latKey]) && isValidCoord(obj[lngKey]);
}

// Rough bounding box used to pre-filter rows before the exact haversine check.
export function boundingBox(lat, lng, radiusKm) {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// Compares a responder's reported position with a destination.
// VERIFIED when within `radiusM` plus the phone's own accuracy margin (capped at 500 m so a very poor fix cannot verify).
export function checkLocation(position, destination, radiusM) {
  if (!position || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) {
    return { locationCheck: 'NO_LOCATION', distanceM: null, allowedM: null };
  }
  if (!destination || !Number.isFinite(destination.latitude) || !Number.isFinite(destination.longitude)) {
    return { locationCheck: 'NO_DESTINATION', distanceM: null, allowedM: null };
  }
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(destination.latitude - position.latitude);
  const dLng = rad(destination.longitude - position.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(position.latitude)) * Math.cos(rad(destination.latitude)) * Math.sin(dLng / 2) ** 2;
  const distanceM = Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
  const allowedM = radiusM + Math.min(Math.max(position.accuracyMeters ?? 0, 0), 500);
  return { locationCheck: distanceM <= allowedM ? 'VERIFIED' : 'TOO_FAR', distanceM, allowedM };
}
