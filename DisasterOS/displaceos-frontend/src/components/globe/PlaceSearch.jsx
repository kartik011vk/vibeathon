// "Search the map" box: countries, ~7,300 cities and towns (Natural Earth), and DisplaceOS places.
import { useEffect, useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { loadPlaces } from './worldData.js';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function PlaceSearch({ markers, onPick }) {
  const [places, setPlaces] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  useEffect(() => {
    if (open && !places) loadPlaces().then(setPlaces);
  }, [open, places]);

  const results = useMemo(() => {
    const s = norm(q.trim());
    if (s.length < 2) return [];
    const out = [];
    const push = (r) => out.length < 8 && out.push(r);
    for (const m of markers) if (norm(m.label).includes(s)) push({ key: m.id, name: m.label, sub: m.sub, latitude: m.latitude, longitude: m.longitude, distance: 1.25 });
    if (places) {
      for (const [name, lat, lng] of places.countries) if (norm(name).startsWith(s)) push({ key: `c-${name}`, name, sub: 'Country', latitude: lat, longitude: lng, distance: 1.9 });
      for (const [name, lat, lng, , , , country] of places.cities) if (norm(name).startsWith(s)) push({ key: `t-${name}-${lat}`, name, sub: country, latitude: lat, longitude: lng, distance: 1.3 });
      for (const [name, lat, lng, , , , country] of places.cities) if (!norm(name).startsWith(s) && norm(name).includes(s)) push({ key: `u-${name}-${lat}`, name, sub: country, latitude: lat, longitude: lng, distance: 1.3 });
    }
    return out;
  }, [q, places, markers]);

  const pick = (r) => {
    onPick(r);
    setQ(r.name);
    setOpen(false);
  };

  return (
    <div className="place-search" role="search">
      <label htmlFor={`${listId}-input`} className="visually-hidden">
        Search the map for a country, city or relief place
      </label>
      <Search size={16} aria-hidden="true" className="place-search-icon" />
      <input
        id={`${listId}-input`}
        className="input"
        placeholder="Search a city, country or camp…"
        value={q}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && results.length > 0 && (
        <ul id={listId} role="listbox" className="place-search-list">
          {results.map((r, i) => (
            <li key={r.key} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={() => pick(r)} onMouseEnter={() => setActive(i)}>
              <strong>{r.name}</strong>
              <span className="small muted"> · {r.sub}</span>
            </li>
          ))}
        </ul>
      )}
      {open && q.trim().length >= 2 && places && results.length === 0 && <div className="place-search-list small muted" style={{ padding: 10 }}>No place found</div>}
    </div>
  );
}
