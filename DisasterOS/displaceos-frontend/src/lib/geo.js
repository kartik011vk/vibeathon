// Straight-line (great-circle) distance in km, or null when either point is missing/invalid.
export function haversineKm(a, b) {
  if (!validPoint(a) || !validPoint(b)) return null;
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export function validPoint(p) {
  return (
    p != null &&
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number' &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  );
}

export function parseCoordinate(value, kind) {
  const n = Number(String(value).trim());
  if (value === '' || !Number.isFinite(n)) return null;
  if (kind === 'lat' && Math.abs(n) > 90) return null;
  if (kind === 'lng' && Math.abs(n) > 180) return null;
  return Math.round(n * 1e6) / 1e6;
}
