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
