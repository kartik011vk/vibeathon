// Live hazard alerts for India from NDMA SACHET (official), USGS and GDACS, served by /api/v1/hazards.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, BadgeCheck, CloudLightning, CloudRain, Crosshair, Droplets, ExternalLink, Flame, Mountain, RefreshCw, Sun, Tornado, Waves, X } from 'lucide-react';
import { hazardsApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/Toast.jsx';
import { useGeolocation } from '../../hooks/useGeolocation.js';
import { Badge, EmptyState, ErrorState, Loading, Notice, SeverityBadge } from '../../components/ui/index.jsx';
import { distanceLabel, formatDateTime, timeAgo } from '../../lib/format.js';

const LeafletMap = lazy(() => import('../../components/map/LeafletMap.jsx'));

export const HAZARD = {
  EARTHQUAKE: ['Earthquake', Activity],
  FLOOD: ['Flood', Waves],
  CYCLONE: ['Cyclone', Tornado],
  TSUNAMI: ['Tsunami', Waves],
  LANDSLIDE: ['Landslide', Mountain],
  THUNDERSTORM: ['Thunderstorm', CloudLightning],
  LIGHTNING: ['Lightning', CloudLightning],
  HEAVY_RAIN: ['Heavy rain', CloudRain],
  HEATWAVE: ['Heatwave', Sun],
  COLD_WAVE: ['Cold wave', Droplets],
  WILDFIRE: ['Fire', Flame],
  DROUGHT: ['Drought', Sun],
  VOLCANO: ['Volcano', Mountain],
  OTHER: ['Weather alert', CloudRain],
};
export const SOURCE = {
  NDMA_SACHET: { label: 'NDMA · Government of India', official: true },
  USGS: { label: 'USGS', official: false },
  GDACS: { label: 'GDACS (UN / EU)', official: false },
};

const FILTERS = [
  { key: 'all', label: 'All', types: null },
  { key: 'quake', label: 'Earthquakes', types: ['EARTHQUAKE', 'TSUNAMI'] },
  { key: 'flood', label: 'Floods & cyclones', types: ['FLOOD', 'CYCLONE', 'LANDSLIDE'] },
  { key: 'storm', label: 'Rain & storms', types: ['HEAVY_RAIN', 'THUNDERSTORM', 'LIGHTNING'] },
  { key: 'heat', label: 'Heat & cold', types: ['HEATWAVE', 'COLD_WAVE', 'DROUGHT'] },
];

export function SourceBadge({ source }) {
  const s = SOURCE[source] ?? { label: source };
  return s.official ? (
    <Badge className="sev-HIGH">
      <BadgeCheck size={13} aria-hidden="true" /> Official · {s.label}
    </Badge>
  ) : (
    <Badge outline>{s.label}</Badge>
  );
}

function FeedHealth({ feeds }) {
  if (!feeds?.length) return null;
  return (
    <p className="small muted" style={{ margin: 0 }}>
      Sources:{' '}
      {feeds.map((f, i) => (
        <span key={f.source}>
          {i ? ' · ' : ''}
          {SOURCE[f.source]?.label ?? f.source}{' '}
          {f.healthy ? (
            <span>checked {timeAgo(f.lastSuccessAt)} ✓</span>
          ) : f.lastAttemptAt ? (
            <strong style={{ color: 'var(--sev-red-fg)' }}>unreachable{f.lastSuccessAt ? ` (last success ${timeAgo(f.lastSuccessAt)})` : ''}</strong>
          ) : (
            <span>not checked yet</span>
          )}
        </span>
      ))}
    </p>
  );
}

const RANK = ['NORMAL', 'HIGH', 'RED', 'HYPER_RED'];

// Most serious first; identical alerts from the same state and source (e.g. a lightning warning issued for
// many blocks of mandals) are merged into one card that lists every area.
export function groupHazards(items) {
  const groups = new Map();
  for (const e of items) {
    const key = e.latitude == null ? `${e.source}|${e.title}|${e.state ?? ''}|${e.severity}` : e.id;
    const g = groups.get(key);
    if (g) {
      g.areas.push(e.areaDescription);
      g.count += 1;
      if (new Date(e.startsAt) > new Date(g.startsAt)) Object.assign(g, { startsAt: e.startsAt, id: e.id });
      if (e.expiresAt && (!g.expiresAt || new Date(e.expiresAt) > new Date(g.expiresAt))) g.expiresAt = e.expiresAt;
    } else {
      groups.set(key, { ...e, areas: [e.areaDescription], count: 1, firstId: e.id });
    }
  }
  return [...groups.values()].sort((a, b) => RANK.indexOf(b.severity) - RANK.indexOf(a.severity) || new Date(b.startsAt) - new Date(a.startsAt));
}

function HazardCard({ e, coordinator, onZone }) {
  const [label, Icon] = HAZARD[e.hazardType] ?? HAZARD.OTHER;
  const [open, setOpen] = useState(false);
  const areaParts = (e.areas ?? [e.areaDescription]).filter(Boolean);
  // For merged alerts show the shared message once, then the list of areas.
  const shared = areaParts.length > 1 ? areaParts[0].split(' — ')[0] : null;
  const area = shared ? `${shared} — Areas: ${[...new Set(areaParts.map((a) => a.split(' — ').slice(1).join(' — ') || a))].join('; ')}` : areaParts[0] ?? '';
  return (
    <article className="card card-tight hazard-card" id={`hazard-${e.firstId ?? e.id}`}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <span className={`hazard-icon sev-${e.severity}`}>
            <Icon size={18} aria-hidden="true" />
          </span>
          <div>
            <strong>{e.title}</strong>
            {e.state && <span className="muted"> · {e.state}</span>}
            {e.count > 1 && <Badge outline>{e.count} areas</Badge>}
            <div className="small muted">
              {label} · {e.sourceSeverity}
              {e.distanceKm != null ? ` · ${distanceLabel(e.distanceKm)}` : ''}
            </div>
          </div>
        </div>
        <SeverityBadge severity={e.severity} />
      </div>
      {area && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          {open || area.length < 220 ? area : `${area.slice(0, 220)}… `}
          {area.length >= 220 && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 0, padding: '0 4px' }} onClick={() => setOpen((v) => !v)}>
              {open ? 'less' : 'more'}
            </button>
          )}
        </p>
      )}
      {e.instruction && e.instruction !== 'Please follow SDMA guidelines.' && <p className="small" style={{ margin: '6px 0 0' }}><strong>Advice:</strong> {e.instruction}</p>}
      <div className="row small" style={{ marginTop: 8 }}>
        <SourceBadge source={e.source} />
        <span className="muted">
          {formatDateTime(e.startsAt)}
          {e.expiresAt ? ` → ${new Date(e.expiresAt) > new Date() ? 'until' : 'ended'} ${formatDateTime(e.expiresAt)}` : ''}
        </span>
        {e.latitude == null && <span className="muted">· area only, not mapped</span>}
        {e.sourceUrl && (
          <a href={e.sourceUrl} target="_blank" rel="noreferrer">
            Source <ExternalLink size={12} aria-hidden="true" />
          </a>
        )}
        {coordinator && e.latitude != null && !e.disasterZoneId && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onZone(e)}>
            Create disaster zone
          </button>
        )}
        {e.disasterZoneId && <Badge outline>Disaster zone opened</Badge>}
      </div>
    </article>
  );
}

export default function LiveIndiaFeed() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const geo = useGeolocation();
  const [filter, setFilter] = useState('all');
  const [window_, setWindow] = useState('active');
  const [officialOnly, setOfficialOnly] = useState(false);
  const [nearMe, setNearMe] = useState(false);
  const coordinator = hasRole('RELIEF_COORDINATOR', 'ADMIN');
  const types = FILTERS.find((f) => f.key === filter).types;

  useEffect(() => {
    if (nearMe && geo.status === 'idle') geo.request();
  }, [nearMe]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = useQuery({
    queryKey: ['hazards', 'list', filter, window_, officialOnly, nearMe && geo.position?.latitude, nearMe && geo.position?.longitude],
    queryFn: () =>
      hazardsApi.list({
        type: types ?? undefined,
        activeOnly: window_ === 'active',
        sinceHours: window_ === 'active' ? 72 : 168,
        source: officialOnly ? 'NDMA_SACHET' : undefined,
        ...(nearMe && geo.position ? { latitude: geo.position.latitude, longitude: geo.position.longitude, radiusKm: 200 } : {}),
      }),
    enabled: !nearMe || Boolean(geo.position),
    refetchInterval: 60000,
  });
  const refresh = useMutation({ mutationFn: hazardsApi.refresh, onSuccess: () => (toast('Feeds checked'), qc.invalidateQueries({ queryKey: ['hazards'] })) });
  const zone = useMutation({
    mutationFn: (e) => hazardsApi.createZone(e.id),
    onSuccess: (z) => (toast(`Disaster zone “${z.name}” created`), qc.invalidateQueries({ queryKey: ['hazards'] }), qc.invalidateQueries({ queryKey: ['zones'] })),
  });

  const items = useMemo(() => q.data?.data ?? [], [q.data]);
  const mapped = useMemo(() => items.filter((e) => e.latitude != null), [items]);
  const grouped = useMemo(() => groupHazards(items), [items]);
  // Links from the pop-up (#hazard-<id>) scroll to the alert once it is loaded.
  useEffect(() => {
    if (q.data && window.location.hash.startsWith('#hazard-')) document.querySelector(window.location.hash)?.scrollIntoView({ block: 'center' });
  }, [q.data]);

  return (
    <section id="live" aria-labelledby="live-h" className="stack">
      <div className="row-between">
        <div>
          <div className="eyebrow">Updates automatically every few minutes</div>
          <h2 id="live-h" style={{ margin: 0 }}>
            Live alerts across India
          </h2>
        </div>
        {coordinator && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw size={14} /> {refresh.isPending ? 'Checking…' : 'Check feeds now'}
          </button>
        )}
      </div>
      <FeedHealth feeds={q.data?.meta?.feeds} />
      <div className="row" role="group" aria-label="Type of hazard">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="row">
        <select className="input" style={{ width: 'auto' }} aria-label="Time window" value={window_} onChange={(e) => setWindow(e.target.value)}>
          <option value="active">Active now</option>
          <option value="week">Last 7 days</option>
        </select>
        <label className="checkbox small">
          <input type="checkbox" checked={officialOnly} onChange={(e) => setOfficialOnly(e.target.checked)} /> Official government alerts only
        </label>
        <button type="button" className={`btn btn-sm ${nearMe ? 'btn-amber' : 'btn-secondary'}`} aria-pressed={nearMe} onClick={() => setNearMe((v) => !v)}>
          {nearMe ? <X size={14} /> : <Crosshair size={14} />} {nearMe ? 'Showing within 200 km of me' : 'Near me'}
        </button>
      </div>
      {nearMe && geo.error && <Notice tone="warn">{geo.error.replace(' — choose your location manually below', '')}</Notice>}
      {nearMe && geo.position && <p className="small muted" style={{ margin: 0 }}>Near-me shows only alerts with a map position. Official NDMA alerts give district or area names, so check the full list for your state too.</p>}

      {mapped.length > 0 && (
        <Suspense fallback={<Loading label="Loading map…" />}>
          <LeafletMap
            label="Map of live alerts in India"
            you={nearMe ? geo.position : null}
            fallbackCenter={[22.5, 79]}
            fallbackZoom={4}
            singleZoom={6}
            maxZoom={7}
            markers={mapped.map((e) => ({
              id: e.id,
              latitude: e.latitude,
              longitude: e.longitude,
              kind: 'hazard',
              title: e.title,
              popup: (
                <div>
                  <strong>{e.title}</strong>
                  <div>{e.areaDescription?.slice(0, 120)}</div>
                  <div>
                    {SOURCE[e.source]?.label} · {timeAgo(e.startsAt)}
                  </div>
                </div>
              ),
            }))}
          />
        </Suspense>
      )}

      {q.isPending && (nearMe ? geo.position : true) && <Loading rows={3} label="Loading live alerts…" />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && items.length === 0 && (
        <EmptyState title={window_ === 'active' ? 'No matching alerts are active in India right now' : 'No matching alerts in the last 7 days'}>
          {q.data.meta.feeds?.some((f) => !f.healthy) ? 'Some sources could not be reached — see the source status above.' : 'This list updates on its own.'}
        </EmptyState>
      )}
      <div className="stack">
        {grouped.map((e) => (
          <HazardCard key={e.firstId} e={e} coordinator={coordinator} onZone={(x) => zone.mutate(x)} />
        ))}
      </div>
      {zone.isError && <Notice tone="danger">{zone.error.message}</Notice>}
      <p className="small muted">
        Earthquakes: USGS (magnitude 3+, India region). Multi-hazard: GDACS. Official warnings: NDMA SACHET, the Government of India's Common Alerting Protocol feed with alerts from IMD and state disaster authorities. Follow instructions from local authorities.
      </p>
    </section>
  );
}

// Pop-up card for new high-impact events (earthquakes M4.5+, floods, cyclones, extreme warnings). Shown once per event.
export function HazardPopup() {
  const q = useQuery({ queryKey: ['hazards', 'popup'], queryFn: () => hazardsApi.list({ activeOnly: false, sinceHours: 3, limit: 20 }), refetchInterval: 60000 });
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('dos-hazard-dismissed') ?? '[]');
    } catch {
      return [];
    }
  });
  const fresh = (q.data?.data ?? []).filter((e) => e.popup && Date.now() - new Date(e.startsAt).getTime() < 2 * 3600 * 1000 && !dismissed.includes(e.id)).slice(0, 2);
  const dismiss = (id) => {
    const next = [...dismissed, id].slice(-200);
    setDismissed(next);
    try {
      localStorage.setItem('dos-hazard-dismissed', JSON.stringify(next));
    } catch {
      // Optional.
    }
  };
  if (!fresh.length) return null;
  return (
    <div className="hazard-popups" aria-live="assertive">
      {fresh.map((e) => {
        const [label, Icon] = HAZARD[e.hazardType] ?? HAZARD.OTHER;
        return (
          <div key={e.id} className={`hazard-popup sev-border-${e.severity}`} role="alert">
            <div className="row-between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <span className={`hazard-icon sev-${e.severity}`}>
                  <Icon size={18} aria-hidden="true" />
                </span>
                <div>
                  <div className="eyebrow" style={{ margin: 0 }}>
                    {label} alert · India
                  </div>
                  <strong>
                    {e.title}
                    {e.state ? ` — ${e.state}` : ''}
                  </strong>
                  <div className="small">{(e.areaDescription ?? '').slice(0, 140)}</div>
                  <div className="small muted">
                    {SOURCE[e.source]?.official ? 'Official · ' : ''}
                    {SOURCE[e.source]?.label} · {timeAgo(e.startsAt)}
                  </div>
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" aria-label="Dismiss alert" onClick={() => dismiss(e.id)}>
                <X size={16} />
              </button>
            </div>
            <Link to={`/updates#hazard-${e.id}`} className="btn btn-sm btn-primary" style={{ marginTop: 8 }} onClick={() => dismiss(e.id)}>
              View details
            </Link>
          </div>
        );
      })}
    </div>
  );
}
