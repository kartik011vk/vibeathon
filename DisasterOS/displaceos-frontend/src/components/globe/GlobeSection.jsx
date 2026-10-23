import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Globe2, Map as MapIcon, Minus, Pause, Play, Plus, X } from 'lucide-react';
import { hazardsApi, placesApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { HAZARD_LABELS, LOCATION_TYPES, REQUEST_STATUS } from '../../lib/format.js';
import { SeverityBadge } from '../ui/index.jsx';
import { clusterMarkers, MARKER_KINDS } from './markers.js';
import FlatWorldMap from './FlatWorldMap.jsx';
import PlaceSearch from './PlaceSearch.jsx';

// Markers closer than this merge into one cluster; the radius shrinks as you zoom in.
const CLUSTER_KM = [60, 30, 12, 4, 1.5];

const Globe3D = lazy(() => import('./Globe3D.jsx'));

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function readPref() {
  try {
    return localStorage.getItem('dos-globe-mode');
  } catch {
    return null;
  }
}

function useMarkers() {
  const { user, hasRole } = useAuth();
  const resources = useQuery({ queryKey: ['map', 'resources'], queryFn: () => placesApi.mapResources() });
  const zones = useQuery({ queryKey: ['zones', 'open'], queryFn: () => placesApi.zones({ status: 'ACTIVE,MONITORING' }) });
  const requests = useQuery({ queryKey: ['map', 'requests', user?.id], queryFn: () => placesApi.mapRequests(), enabled: Boolean(user) });
  const hazards = useQuery({ queryKey: ['hazards', 'globe'], queryFn: () => hazardsApi.list({ activeOnly: true, sinceHours: 72, limit: 100 }), refetchInterval: 120000 });
  const teams = useQuery({ queryKey: ['map', 'teams'], queryFn: () => placesApi.mapTeams(), enabled: hasRole('RELIEF_COORDINATOR', 'ADMIN') });

  const markers = useMemo(() => {
    const list = [];
    for (const l of resources.data ?? []) {
      list.push({
        id: `loc-${l.id}`,
        kind: ['CAMP', 'SHELTER'].includes(l.type) ? 'camp' : 'resource',
        latitude: l.latitude,
        longitude: l.longitude,
        label: l.name,
        sub: `${LOCATION_TYPES[l.type]}${l.area ? ` · ${l.area}` : ''}`,
        to: `/help?location=${l.id}`,
        action: 'See supplies here',
      });
    }
    for (const z of zones.data ?? []) {
      if (z.centerLat == null || z.centerLng == null) continue;
      list.push({
        id: `zone-${z.id}`,
        kind: 'zone',
        latitude: z.centerLat,
        longitude: z.centerLng,
        label: z.name,
        sub: `${HAZARD_LABELS[z.hazardType] ?? z.hazardType} · ${z.status.toLowerCase()}`,
        severity: z.severity,
        to: `/updates#zone-${z.id}`,
        action: 'Read update',
      });
    }
    for (const r of requests.data ?? []) {
      list.push({
        id: `req-${r.id}`,
        kind: 'request',
        latitude: r.latitude,
        longitude: r.longitude,
        label: `Request ${r.referenceCode}`,
        sub: REQUEST_STATUS[r.status],
        severity: user?.role === 'CITIZEN' ? undefined : r.severity,
        to: `/requests/${r.id}`,
        action: 'Open request',
      });
    }
    for (const h of hazards.data?.data ?? []) {
      if (h.latitude == null) continue;
      list.push({
        id: `hz-${h.id}`,
        kind: 'hazard',
        latitude: h.latitude,
        longitude: h.longitude,
        label: h.title,
        sub: `${h.areaDescription?.slice(0, 80) ?? ''} · ${h.source.replace('_', ' ')}`,
        severity: h.severity,
        to: `/updates#hazard-${h.id}`,
        action: 'Read alert',
      });
    }
    for (const t of teams.data ?? []) {
      list.push({
        id: `team-${t.id}`,
        kind: 'team',
        latitude: t.latitude,
        longitude: t.longitude,
        label: t.name,
        sub: t.stale ? 'Position is out of date' : 'Recent position',
        to: '/ops/dispatch',
        action: 'Open dispatch board',
      });
    }
    return list;
  }, [resources.data, zones.data, requests.data, teams.data, hazards.data, user]);

  return { markers, loading: resources.isPending || zones.isPending, error: resources.error || zones.error };
}

export default function GlobeSection() {
  const canWebgl = useMemo(webglAvailable, []);
  const reduced = useMemo(prefersReducedMotion, []);
  const [mode, setMode] = useState(() => readPref() ?? (canWebgl && !reduced ? '3d' : '2d'));
  const [autoRotate, setAutoRotate] = useState(!reduced);
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(null);
  const [zoomBucket, setZoomBucket] = useState(0);
  const controlRef = useRef(null);
  const { markers, loading, error } = useMarkers();
  const clusters = useMemo(() => clusterMarkers(markers, CLUSTER_KM[zoomBucket]), [markers, zoomBucket]);
  const show3d = mode === '3d' && canWebgl;

  const choose = (m) => {
    setMode(m);
    try {
      localStorage.setItem('dos-globe-mode', m);
    } catch {
      // Preference is optional.
    }
  };

  const select = (c) => {
    setSelected(c);
    if (c) setFocus({ latitude: c.latitude, longitude: c.longitude });
  };
  const kindsPresent = [...new Set(markers.map((m) => m.kind))];

  return (
    <div>
      {show3d && <PlaceSearch markers={markers} onPick={(r) => (setSelected(null), setFocus({ latitude: r.latitude, longitude: r.longitude, distance: r.distance, name: r.name, at: Date.now() }))} />}
      <div className="globe-stage">
        {show3d ? (
          <Suspense fallback={<div className="state">Loading globe…</div>}>
            <Globe3D clusters={clusters} selectedId={selected?.id} onSelect={select} focus={focus} autoRotate={autoRotate && !selected && !focus?.distance} controlRef={controlRef} onZoomBucket={setZoomBucket} />
          </Suspense>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <FlatWorldMap clusters={clusters} selectedId={selected?.id} onSelect={select} />
          </div>
        )}

        {selected && (
          <div className="card card-tight globe-card" role="region" aria-label="Selected place">
            <div className="row-between">
              <span className="eyebrow" style={{ margin: 0 }}>
                {selected.items.length > 1 ? `${selected.items.length} places here` : MARKER_KINDS[selected.kind].label}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <ul className="list">
              {selected.items.slice(0, 6).map((m) => (
                <li key={m.id} className="list-item" style={{ padding: '8px 0' }}>
                  <strong style={{ display: 'block' }}>{m.label}</strong>
                  <span className="small muted">{m.sub}</span>
                  <div className="row" style={{ marginTop: 6 }}>
                    {m.severity && <SeverityBadge severity={m.severity} />}
                    <Link to={m.to} className="small">
                      {m.action} →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
            {selected.items.length > 6 && <p className="small muted">and {selected.items.length - 6} more — see the list below.</p>}
          </div>
        )}
      </div>

      <div className="globe-legend" aria-label="Map legend">
        {kindsPresent.map((k) => (
          <span key={k}>
            <span className="swatch" style={{ background: MARKER_KINDS[k].color, border: '1.5px solid #2d221b', borderRadius: '50%' }} />
            {MARKER_KINDS[k].label}
          </span>
        ))}
        {!loading && !error && markers.length === 0 && <span>No mapped locations have been published yet.</span>}
        {error && <span>Map locations could not be loaded right now.</span>}
      </div>

      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
        {show3d && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => controlRef.current?.zoomBy(0.8)} aria-label="Zoom in">
              <Plus size={16} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => controlRef.current?.zoomBy(1.25)} aria-label="Zoom out">
              <Minus size={16} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => controlRef.current?.rotate(-90)} aria-label="Rotate globe west">
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAutoRotate((v) => !v)} aria-pressed={autoRotate}>
              {autoRotate ? <Pause size={16} /> : <Play size={16} />} {autoRotate ? 'Pause rotation' : 'Rotate'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => controlRef.current?.rotate(90)} aria-label="Rotate globe east">
              <ChevronRight size={16} />
            </button>
          </>
        )}
        {canWebgl ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => choose(show3d ? '2d' : '3d')}>
            {show3d ? <MapIcon size={16} /> : <Globe2 size={16} />} {show3d ? 'Use flat map' : 'Use 3D globe'}
          </button>
        ) : (
          <span className="small muted">3D view is not supported on this device — showing a flat map.</span>
        )}
      </div>

      {markers.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="small" style={{ cursor: 'pointer', textAlign: 'center' }}>
            Show all {markers.length} mapped places as a list
          </summary>
          <ul className="list card card-tight" style={{ marginTop: 10 }}>
            {markers.map((m) => (
              <li key={m.id} className="list-item row-between" style={{ padding: '8px 0' }}>
                <span>
                  <strong>{m.label}</strong> <span className="small muted">· {m.sub}</span>
                </span>
                <span className="row">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setSelected(clusters.find((c) => c.items.includes(m)) ?? null), setFocus({ latitude: m.latitude, longitude: m.longitude, distance: 1.25, at: Date.now() }))}>
                    Show on globe
                  </button>
                  <Link to={m.to} className="small">
                    {m.action}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
