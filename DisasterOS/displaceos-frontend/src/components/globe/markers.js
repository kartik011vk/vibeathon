import { haversineKm, validPoint } from '../../lib/geo.js';

export const MARKER_KINDS = {
  hazard: { label: 'Live alert (NDMA / USGS / GDACS)', color: '#8F2C0B', priority: 6 },
  zone: { label: 'Disaster zone', color: '#C2561A', priority: 5 },
  request: { label: 'Your request', color: '#F4AE37', priority: 4 },
  camp: { label: 'Camp or shelter', color: '#FFF9ED', priority: 3 },
  resource: { label: 'Supply point', color: '#F4AE37', priority: 2 },
  team: { label: 'Response team', color: '#2D221B', priority: 1 },
};

// Groups markers closer than `radiusKm` so they stay clickable at globe scale. Only markers with valid
// coordinates are placed — nothing is positioned by guesswork.
export function clusterMarkers(markers, radiusKm = 60) {
  const clusters = [];
  for (const m of markers) {
    if (!validPoint(m)) continue;
    const hit = clusters.find((c) => haversineKm(c, m) <= radiusKm);
    if (hit) {
      hit.items.push(m);
      if (MARKER_KINDS[m.kind].priority > MARKER_KINDS[hit.kind].priority) hit.kind = m.kind;
    } else {
      clusters.push({ id: `c-${m.id}`, latitude: m.latitude, longitude: m.longitude, kind: m.kind, items: [m] });
    }
  }
  for (const c of clusters) {
    c.latitude = c.items.reduce((s, m) => s + m.latitude, 0) / c.items.length;
    c.longitude = c.items.reduce((s, m) => s + m.longitude, 0) / c.items.length;
  }
  return clusters;
}

// Unit-sphere position matching three.js SphereGeometry UVs for an equirectangular texture.
export function latLngToVec(lat, lng, r = 1) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

// Group rotation that brings (lat, lng) to face a camera on the +Z axis.
export function rotationFor(lat, lng) {
  const theta = ((lng + 180) * Math.PI) / 180;
  return { x: (lat * Math.PI) / 180, y: Math.PI / 2 - theta };
}
