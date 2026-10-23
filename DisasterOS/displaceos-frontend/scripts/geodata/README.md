# Globe geodata

The globe's place names and state/province boundaries come from [Natural Earth](https://www.naturalearthdata.com/)
(public domain). The generated files in `src/data/` are committed, so you only need these scripts to refresh them.

| Output | Source | Script |
|---|---|---|
| `src/data/cities.json` — `[name, lat, lng, scalerank, population, capital, country]` (7,342 places) | `ne_10m_populated_places_simple` | `places.mjs` |
| `src/data/country-labels.json` — `[name, lat, lng, areaKm2]` | world-atlas `countries-50m` (label point inside each country) | `places.mjs` |
| `src/data/admin1-lines.json` — flat `[lng, lat, ...]` polylines | `ne_10m_admin_1_states_provinces_lines`, Douglas–Peucker 0.05°, 2-decimal coordinates | `admin1-lines.mjs` |

```bash
mkdir -p raw
curl -L -o raw/ne_10m_populated_places_simple.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson
curl -L -o raw/ne_10m_admin_1_states_provinces_lines.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lines.geojson
npm i --no-save mapshaper@0.6 topojson-client@3
node scripts/geodata/places.mjs raw node_modules/world-atlas/countries-50m.json src/data
node scripts/geodata/admin1-lines.mjs raw/ne_10m_admin_1_states_provinces_lines.geojson src/data/admin1-lines.json 0.05
```

Boundaries follow Natural Earth's de facto lines. Some disputed areas are drawn as separate polygons there; the
globe does not label them as countries (see `UNLABELLED` in `src/components/globe/Globe3D.jsx`).
