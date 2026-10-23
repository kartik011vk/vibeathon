// Simplifies Natural Earth 1:10m state/province boundary lines into flat [lng,lat,lng,lat,...] arrays.
// Usage: node admin1.mjs <in.geojson> <out.json> [toleranceDegrees]
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output, tolArg] = process.argv.slice(2);
const tol = Number(tolArg ?? 0.02);

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  if (!len) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function simplify(points) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(points[i], points[s], points[e]);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const gj = JSON.parse(readFileSync(input, 'utf8'));
const lines = [];
let pts = 0;
for (const f of gj.features) {
  const g = f.geometry;
  if (!g) continue;
  const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const part of parts) {
    const s = simplify(part);
    if (s.length < 2) continue;
    const flat = [];
    for (const [lng, lat] of s) flat.push(Math.round(lng * 100) / 100, Math.round(lat * 100) / 100);
    lines.push(flat);
    pts += s.length;
  }
}
const json = JSON.stringify(lines);
writeFileSync(output, json);
console.log(`lines ${lines.length}, points ${pts}, bytes ${json.length}`);
