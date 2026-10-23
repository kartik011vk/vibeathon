// Builds compact place-name and boundary data for the DisplaceOS globe from Natural Earth (public domain).
// Usage: node places.mjs <rawDir> <worldAtlasCountries50mJson> <outDir>
// Needs: npm i --no-save mapshaper@0.6 topojson-client@3
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import mapshaper from 'mapshaper';
import { feature } from 'topojson-client';

const [rawDir, countries50, outDir] = process.argv.slice(2);

// 1. Cities: [name, lat, lng, scalerank, population, isCapital(0/1/2), country]
const places = JSON.parse(readFileSync(path.join(rawDir, 'ne_10m_populated_places_simple.geojson'), 'utf8'));
const cities = places.features
  .map((f) => {
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    const capital = p.featurecla?.includes('Admin-0 capital') ? 2 : p.featurecla?.includes('Admin-1 capital') ? 1 : 0;
    return [p.name, Math.round(lat * 1000) / 1000, Math.round(lng * 1000) / 1000, p.scalerank ?? 10, p.pop_max ?? 0, capital, p.adm0name ?? ''];
  })
  .filter((c) => c[0] && Number.isFinite(c[1]) && Number.isFinite(c[2]))
  .sort((a, b) => a[3] - b[3] || b[4] - a[4]);
writeFileSync(path.join(outDir, 'cities.json'), JSON.stringify(cities));
console.log('cities', cities.length);

// 2. Country label points (a point guaranteed inside each country) with area for priority.
const labelsOut = await mapshaper.applyCommands(
  `-i in.json -each 'area=this.area' -points inner -o format=geojson out.json`,
  { 'in.json': JSON.stringify(feature(JSON.parse(readFileSync(countries50, 'utf8')), JSON.parse(readFileSync(countries50, 'utf8')).objects.countries)) },
);
const pts = JSON.parse(labelsOut['out.json']);
const labels = pts.features
  .filter((f) => f.geometry && f.properties.name)
  .map((f) => [f.properties.name, Math.round(f.geometry.coordinates[1] * 100) / 100, Math.round(f.geometry.coordinates[0] * 100) / 100, Math.round(f.properties.area / 1e6)])
  .sort((a, b) => b[3] - a[3]);
writeFileSync(path.join(outDir, 'country-labels.json'), JSON.stringify(labels));
console.log('country labels', labels.length);
