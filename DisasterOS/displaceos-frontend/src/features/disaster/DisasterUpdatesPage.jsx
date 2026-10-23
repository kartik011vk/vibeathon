import { lazy, Suspense, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, CircleHelp, PhoneCall, Radio } from 'lucide-react';
import { alertsApi, placesApi } from '../../api/services.js';
import { EmptyState, ErrorState, Loading, Notice, PageHead, SeverityBadge, Badge } from '../../components/ui/index.jsx';
import { formatDateTime, HAZARD_LABELS, SEVERITY, timeAgo } from '../../lib/format.js';
import LiveIndiaFeed from '../hazards/LiveIndiaFeed.jsx';

const LeafletMap = lazy(() => import('../../components/map/LeafletMap.jsx'));

const ZONE_STATUS = { ACTIVE: 'Active', MONITORING: 'Being monitored', CLOSED: 'Closed' };

function SourceLine({ verified, source, sourceUrl }) {
  return (
    <div className="row small">
      {verified ? (
        <Badge className="sev-HIGH">
          <BadgeCheck size={14} aria-hidden="true" /> Verified by relief coordinators
        </Badge>
      ) : (
        <Badge outline>
          <CircleHelp size={14} aria-hidden="true" /> Not independently verified
        </Badge>
      )}
      <span className="muted">
        Source: {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{source}</a> : source}
      </span>
    </div>
  );
}

export default function DisasterUpdatesPage() {
  const zones = useQuery({ queryKey: ['zones', 'all'], queryFn: () => placesApi.zones(), refetchInterval: 120000 });
  const alerts = useQuery({ queryKey: ['alerts', 'active', 'public'], queryFn: () => alertsApi.active(), refetchInterval: 60000 });

  useEffect(() => {
    if (zones.data && window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView();
  }, [zones.data]);

  const open = (zones.data ?? []).filter((z) => z.status !== 'CLOSED');
  const closed = (zones.data ?? []).filter((z) => z.status === 'CLOSED');
  const publicAlerts = alerts.data?.data ?? [];

  return (
    <div className="container">
      <PageHead eyebrow="Disaster updates" title="What is happening, and where">
        Alerts and affected areas published by DisplaceOS relief coordinators, with their source and the time they were last updated.
      </PageHead>

      <div className="stack-lg">
        <div className="grid grid-2">
          <Notice tone="strong" icon={PhoneCall} title="If you or someone near you is in danger">
            Contact local emergency services first — in India, dial <strong>112</strong>. Follow instructions from local authorities. DisplaceOS arranges relief supplies and does not dispatch rescue.
          </Notice>
          <Notice icon={Radio} title="About this information">
            Live alerts come from NDMA SACHET (the Government of India's official alert feed), USGS (earthquakes) and GDACS (UN/EU). Areas and alerts further down are published by DisplaceOS relief coordinators. Every item shows its source.
          </Notice>
        </div>

        <LiveIndiaFeed />

        <section aria-labelledby="alerts-h">
          <h2 id="alerts-h">Alerts from DisplaceOS coordinators</h2>
          {alerts.isPending && <Loading rows={2} />}
          {alerts.isError && <ErrorState error={alerts.error} onRetry={alerts.refetch} />}
          {alerts.data && publicAlerts.length === 0 && <EmptyState title="No public alerts right now">When coordinators publish an area-wide alert it will appear here.</EmptyState>}
          <div className="stack">
            {publicAlerts.map((a) => (
              <article key={a.id} className="card">
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div className="row">
                    <SeverityBadge severity={a.severity} />
                    {a.status === 'ACKNOWLEDGED' && <Badge outline>Being handled</Badge>}
                  </div>
                  <span className="small muted">Updated {timeAgo(a.updatedAt)}</span>
                </div>
                <h3 style={{ marginTop: 10 }}>{a.title}</h3>
                <p style={{ whiteSpace: 'pre-line' }}>{a.message}</p>
                <div className="small muted">
                  {a.disasterZone ? `Area: ${a.disasterZone.name} · ` : ''}Source: {a.source} · Published {formatDateTime(a.createdAt)}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="zones-h">
          <h2 id="zones-h">Affected areas</h2>
          <p className="muted small">
            Severity levels: {Object.entries(SEVERITY).map(([k, v], i) => `${i ? ' · ' : ''}${v.label}`)}. Circles on the map are approximate areas, not evacuation boundaries.
          </p>
          {zones.isPending && <Loading rows={2} />}
          {zones.isError && <ErrorState error={zones.error} onRetry={zones.refetch} />}
          {zones.data && (
            <>
              {open.some((z) => z.centerLat != null) && (
                <Suspense fallback={<Loading label="Loading map…" />}>
                  <LeafletMap
                    label="Map of affected areas"
                    markers={open
                      .filter((z) => z.centerLat != null)
                      .map((z) => ({ id: z.id, latitude: z.centerLat, longitude: z.centerLng, kind: 'request', title: z.name, popup: <strong>{z.name}</strong> }))}
                    circles={open.filter((z) => z.centerLat != null && z.radiusKm).map((z) => ({ id: z.id, latitude: z.centerLat, longitude: z.centerLng, radiusKm: z.radiusKm }))}
                  />
                </Suspense>
              )}
              {open.length === 0 && <EmptyState title="No active or monitored areas">Coordinators have not published any affected areas.</EmptyState>}
              <div className="grid grid-2" style={{ marginTop: 16 }}>
                {open.map((z) => (
                  <article key={z.id} id={`zone-${z.id}`} className="card stack">
                    <div className="row-between">
                      <div className="row">
                        <SeverityBadge severity={z.severity} />
                        <Badge outline>{ZONE_STATUS[z.status]}</Badge>
                      </div>
                      <span className="small muted">Updated {timeAgo(z.updatedAt)}</span>
                    </div>
                    <div>
                      <div className="eyebrow" style={{ marginBottom: 2 }}>
                        {HAZARD_LABELS[z.hazardType] ?? z.hazardType}
                      </div>
                      <h3>{z.name}</h3>
                      {z.description && <p style={{ marginBottom: 0 }}>{z.description}</p>}
                    </div>
                    {z.radiusKm && <div className="small muted">Approximate area: within about {z.radiusKm} km of the marked centre</div>}
                    {z._count?.locations > 0 && <div className="small">{z._count.locations} relief location{z._count.locations > 1 ? 's' : ''} inside this area</div>}
                    <SourceLine verified={z.isVerified} source={z.source} sourceUrl={z.sourceUrl} />
                  </article>
                ))}
              </div>
              {closed.length > 0 && (
                <details style={{ marginTop: 16 }}>
                  <summary>Closed areas ({closed.length})</summary>
                  <ul className="list">
                    {closed.map((z) => (
                      <li key={z.id} className="list-item small">
                        {z.name} — closed, last updated {formatDateTime(z.updatedAt)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
