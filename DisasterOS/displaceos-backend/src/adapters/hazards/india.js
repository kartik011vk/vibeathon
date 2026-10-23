// India boundary test for feed events. Uses Natural Earth 1:50m (world-atlas), which follows de facto boundaries;
// feeds that name India explicitly (place text, country field, NDMA) are also accepted.
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
export const INDIA_BBOX = { minLat: 6, maxLat: 37.5, minLng: 68, maxLng: 97.5 };

let polygons = null;
function indiaPolygons() {
  if (polygons) return polygons;
  const topo = require('world-atlas/countries-50m.json');
  const india = feature(topo, topo.objects.countries).features.find((f) => f.properties.name === 'India');
  const g = india.geometry;
  polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polygons;
}

function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inIndiaBbox(lat, lng) {
  return lat >= INDIA_BBOX.minLat && lat <= INDIA_BBOX.maxLat && lng >= INDIA_BBOX.minLng && lng <= INDIA_BBOX.maxLng;
}

export function pointInIndia(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inIndiaBbox(lat, lng)) return false;
  return indiaPolygons().some(([outer, ...holes]) => inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h)));
}
