import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Crosshair, HandHeart, MapPin, Navigation, X } from 'lucide-react';
import { inventoryApi, placesApi } from '../../api/services.js';
import { useGeolocation } from '../../hooks/useGeolocation.js';
import { AvailabilityBadge, EmptyState, ErrorState, Field, Loading, Notice, PageHead } from '../../components/ui/index.jsx';
import { CATEGORIES, categoryLabel, distanceLabel, LOCATION_TYPES, num, timeAgo } from '../../lib/format.js';

const LeafletMap = lazy(() => import('../../components/map/LeafletMap.jsx'));

const FILTERS = [{ value: '', label: 'All supplies' }, ...CATEGORIES.filter((c) => c.value !== 'OTHER')];

export default function FindHelpPage() {
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState(params.get('category') ?? '');
  const onlyLocation = params.get('location');
  const geo = useGeolocation();
  const [origin, setOrigin] = useState(null); // { latitude, longitude, label }
  const [originMode, setOriginMode] = useState('none');
  const places = useQuery({ queryKey: ['locations', 'all'], queryFn: () => placesApi.locations() });

  useEffect(() => {
    if (geo.status === 'ready') setOrigin({ ...geo.position, label: 'your current location' });
  }, [geo.status, geo.position]);

  const q = useQuery({
    queryKey: ['availability', category, origin?.latitude, origin?.longitude, onlyLocation],
    queryFn: () =>
      inventoryApi.availability({
        category: category || undefined,
        latitude: origin?.latitude,
        longitude: origin?.longitude,
        locationId: onlyLocation || undefined,
      }),
    refetchInterval: 120000,
  });

  // Group availability rows by location; the backend already sorts by straight-line distance.
  const groups = useMemo(() => {
    const map = new Map();
    for (const row of q.data?.data ?? []) {
      if (!map.has(row.location.id)) map.set(row.location.id, { location: row.location, distanceKm: row.distanceKm, rows: [] });
      map.get(row.location.id).rows.push(row);
    }
    const order = { AVAILABLE: 0, LIMITED: 1, NOT_CONFIRMED: 2, NOT_AVAILABLE: 3 };
    for (const g of map.values()) g.rows.sort((a, b) => order[a.availabilityStatus] - order[b.availabilityStatus]);
    return [...map.values()];
  }, [q.data]);

  const withStock = groups.filter((g) => g.rows.some((r) => ['AVAILABLE', 'LIMITED'].includes(r.availabilityStatus)));
  const noLocation = onlyLocation && places.data?.find((p) => p.id === onlyLocation);

  return (
    <div className="container">
      <PageHead eyebrow="Find nearby help" title="Food, water, medicine and shelter near you">
        Stock shown here is what camps and warehouses have recorded. Distances are straight-line estimates, not road routes.
      </PageHead>

      <div className="stack-lg">
        <div className="card stack">
          <div className="row" role="group" aria-label="Filter by supply">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" className={`btn btn-sm ${category === f.value ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={category === f.value} onClick={() => setCategory(f.value)}>
                {f.label}
              </button>
            ))}
          </div>
          <hr className="divider" style={{ margin: 0 }} />
          <div className="row">
            <button
              type="button"
              className={`btn btn-sm ${originMode === 'gps' ? 'btn-amber' : 'btn-secondary'}`}
              onClick={() => {
                setOriginMode('gps');
                geo.request();
              }}
              disabled={geo.status === 'locating'}
            >
              <Crosshair size={16} /> {geo.status === 'locating' ? 'Finding you…' : 'Use my location'}
            </button>
            <button type="button" className={`btn btn-sm ${originMode === 'place' ? 'btn-amber' : 'btn-secondary'}`} onClick={() => setOriginMode('place')}>
              <MapPin size={16} /> Choose a place
            </button>
            <button type="button" className={`btn btn-sm ${originMode === 'map' ? 'btn-amber' : 'btn-secondary'}`} onClick={() => setOriginMode('map')}>
              <Navigation size={16} /> Pick on map
            </button>
            {origin && (
              <span className="badge badge-outline">
                Measuring from {origin.label}
                <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 0, padding: 2 }} aria-label="Clear location" onClick={() => (setOrigin(null), setOriginMode('none'), geo.reset())}>
                  <X size={14} />
                </button>
              </span>
            )}
          </div>
          {originMode === 'gps' && geo.status === 'idle' && <p className="small muted">Your browser will ask permission. Your location is used only on this page to measure distance and is not saved.</p>}
          {geo.error && originMode === 'gps' && (
            <Notice tone="warn" title="Location not available">
              {geo.error}
            </Notice>
          )}
          {originMode === 'place' && (
            <Field label="Measure distances from" hint="Pick a camp, shelter or supply point you know.">
              {(a) => (
                <select
                  {...a}
                  className="input"
                  defaultValue=""
                  onChange={(e) => {
                    const p = places.data?.find((x) => x.id === e.target.value);
                    if (p?.latitude != null) setOrigin({ latitude: p.latitude, longitude: p.longitude, label: p.name });
                  }}
                >
                  <option value="" disabled>
                    {places.isPending ? 'Loading places…' : 'Select a place…'}
                  </option>
                  {(places.data ?? [])
                    .filter((p) => p.latitude != null)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              )}
            </Field>
          )}
        </div>

        {onlyLocation && (
          <Notice title={`Showing one location${noLocation ? `: ${noLocation.name}` : ''}`}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setParams({})}>
              Show all locations
            </button>
          </Notice>
        )}

        <Suspense fallback={<Loading label="Loading map…" />}>
          <LeafletMap
            label="Relief locations map"
            you={origin}
            onPick={originMode === 'map' ? (p) => setOrigin({ ...p, label: 'the point you picked' }) : undefined}
            markers={groups
              .filter((g) => g.location.latitude != null)
              .map((g) => ({
                id: g.location.id,
                latitude: g.location.latitude,
                longitude: g.location.longitude,
                kind: ['CAMP', 'SHELTER'].includes(g.location.type) ? 'camp' : 'resource',
                title: g.location.name,
                popup: (
                  <div>
                    <strong>{g.location.name}</strong>
                    <div>{LOCATION_TYPES[g.location.type]}</div>
                    <div>{distanceLabel(g.distanceKm)}</div>
                  </div>
                ),
              }))}
            fallbackCenter={[30.3, 78.05]}
            fallbackZoom={9}
          />
        </Suspense>
        {originMode === 'map' && <p className="small muted">Tap the map to set the point distances are measured from.</p>}

        <section aria-live="polite">
          {q.isPending && <Loading rows={3} label="Loading availability…" />}
          {q.isError && <ErrorState error={q.error} onRetry={q.refetch} title="Availability could not be loaded" />}
          {q.data && groups.length === 0 && (
            <EmptyState
              title={category ? `No location has recorded ${categoryLabel(category).toLowerCase()} stock` : 'No stock has been recorded yet'}
              action={
                <Link to="/request" className="btn btn-primary">
                  <HandHeart size={16} /> Request {category ? categoryLabel(category).toLowerCase() : 'supplies'}
                </Link>
              }
            >
              That does not mean there is none — only that nothing has been entered in DisplaceOS. You can send a request and relief staff will look for a source.
            </EmptyState>
          )}
          {q.data && groups.length > 0 && (
            <div className="stack">
              <p className="small muted">
                {withStock.length} of {groups.length} location{groups.length === 1 ? '' : 's'} have stock confirmed in the last {q.data.meta.staleAfterHours} hours.{' '}
                {origin ? 'Distances are straight-line estimates — the road distance will be longer.' : 'Share or choose a location to see distances.'}
              </p>
              {groups.map((g) => (
                <article key={g.location.id} className="card">
                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <h3 style={{ marginBottom: 2 }}>{g.location.name}</h3>
                      <div className="small muted">
                        {LOCATION_TYPES[g.location.type]}
                        {g.location.address ? ` · ${g.location.address}` : ''}
                      </div>
                    </div>
                    <span className="badge badge-outline">{origin ? distanceLabel(g.distanceKm) : g.location.latitude == null ? 'Distance unavailable' : 'Choose a location to see distance'}</span>
                  </div>
                  <div className="table-wrap" style={{ marginTop: 12 }}>
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Item</th>
                          <th scope="col">Status</th>
                          <th scope="col" className="num">
                            Available
                          </th>
                          <th scope="col">Stock last confirmed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r) => (
                          <tr key={r.item.id}>
                            <td>{r.item.name}</td>
                            <td>
                              <AvailabilityBadge status={r.availabilityStatus} />
                            </td>
                            <td className="num">{r.available == null ? '—' : `${num(r.available)} ${r.item.unit}`}</td>
                            <td className="small">{r.lastConfirmedAt ? timeAgo(r.lastConfirmedAt) : 'Never confirmed'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {category && !g.rows.some((r) => ['AVAILABLE', 'LIMITED'].includes(r.availabilityStatus)) && (
                    <p className="small" style={{ marginTop: 10, marginBottom: 0 }}>
                      No confirmed {categoryLabel(category).toLowerCase()} here right now. Check other locations, or{' '}
                      <Link to="/request">request {categoryLabel(category).toLowerCase()}</Link>.
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
