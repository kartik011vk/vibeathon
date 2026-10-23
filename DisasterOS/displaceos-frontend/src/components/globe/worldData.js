// Real coastlines and borders from Natural Earth (world-atlas, 1:110m), loaded lazily with the globe chunk.
import { feature, mesh } from 'topojson-client';

let cache = null;

export async function loadWorld() {
  if (cache) return cache;
  const topo = (await import('world-atlas/countries-110m.json')).default;
  cache = {
    countries: feature(topo, topo.objects.countries),
    borders: mesh(topo, topo.objects.countries, (a, b) => a !== b),
    land: feature(topo, topo.objects.land),
  };
  return cache;
}

// Rings as continuous longitude sequences (no ±180 jumps), so they can be drawn on an equirectangular canvas.
export function unwrapRing(ring) {
  const out = [];
  let offset = 0;
  let prev = null;
  for (const [lng, lat] of ring) {
    if (prev !== null) {
      const d = lng - prev;
      if (d > 180) offset -= 360;
      else if (d < -180) offset += 360;
    }
    out.push([lng + offset, lat]);
    prev = lng;
  }
  return out;
}

export function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

export function linesOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}
