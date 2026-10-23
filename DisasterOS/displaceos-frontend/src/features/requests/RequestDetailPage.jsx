import { lazy, Suspense, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Copy, Link2, Megaphone, Radio, XCircle } from 'lucide-react';
import { receiptApi, requestsApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useLiveRecord } from '../../app/SocketContext.jsx';
import { useToast } from '../../app/Toast.jsx';
import { Badge, ErrorState, Field, Loading, Notice, ReasonDialog, SeverityBadge } from '../../components/ui/index.jsx';
import { categoryLabel, formatDateTime, timeAgo } from '../../lib/format.js';
import { DispatchCard, EtaPanel, ItemsProgress, StatusStepper, Timeline } from '../tracking/TrackingParts.jsx';

const StaffRequestPanel = lazy(() => import('../ops/StaffRequestPanel.jsx'));
const LeafletMap = lazy(() => import('../../components/map/LeafletMap.jsx'));

// Live map for the requester: the team's real reported position while supplies are on the road.
function LiveDeliveryMap({ dispatch, destination }) {
  const loc = dispatch.location;
  return (
    <section className="card stack" aria-labelledby="live-h">
      <div className="row-between">
        <h2 id="live-h" style={{ fontSize: '1.25rem', margin: 0 }}>
          <Radio size={18} aria-hidden="true" color="var(--orange-deep)" /> Your delivery is on the way
        </h2>
        <span className={`conn ${loc.stale ? 'conn-wait' : 'conn-live'}`}>
          <span className="dot" /> {loc.stale ? 'Position out of date' : 'Live'}
        </span>
      </div>
      <Suspense fallback={<Loading label="Loading map…" />}>
        <LeafletMap
          label="Live position of your delivery team"
          markers={[
            {
              id: dispatch.id,
              latitude: loc.latitude,
              longitude: loc.longitude,
              kind: 'team',
              title: dispatch.team?.name,
              popup: (
                <span>
                  {dispatch.team?.name} · reported {timeAgo(loc.updatedAt)}
                </span>
              ),
            },
          ]}
          you={destination}
          circles={
            loc.accuracyMeters
              ? [{ id: 'accuracy', latitude: loc.latitude, longitude: loc.longitude, radiusKm: loc.accuracyMeters / 1000, pathOptions: { color: '#663e23', weight: 1, fillColor: '#f4ae37', fillOpacity: 0.22 } }]
              : []
          }
        />
      </Suspense>
      <p className="small muted" style={{ margin: 0 }}>
        {dispatch.team?.name} shared this position {timeAgo(loc.updatedAt)}
        {loc.approxDistanceToDestinationKm != null ? ` — about ${loc.approxDistanceToDestinationKm} km from you in a straight line (the road route is longer)` : ''}.
        {loc.accuracyMeters ? ` The phone reports this position as accurate to about ${loc.accuracyMeters} m (shaded circle).` : ' The phone did not report how accurate this position is.'}
        {loc.stale ? ' The team has not updated its position recently.' : ''} Your white pin is the delivery point.
      </p>
    </section>
  );
}

function ShareLinks({ requestId }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [fresh, setFresh] = useState(null);
  const links = useQuery({ queryKey: ['tracking-links', requestId], queryFn: () => requestsApi.trackingLinks(requestId) });
  const create = useMutation({
    mutationFn: () => requestsApi.createTrackingLink(requestId, 168),
    onSuccess: (data) => {
      setFresh(`${window.location.origin}/track/${data.token}`);
      qc.invalidateQueries({ queryKey: ['tracking-links', requestId] });
    },
  });
  const revoke = useMutation({
    mutationFn: (tokenId) => requestsApi.revokeTrackingLink(requestId, tokenId),
    onSuccess: () => {
      toast('Tracking link turned off');
      qc.invalidateQueries({ queryKey: ['tracking-links', requestId] });
    },
  });
  const active = (links.data ?? []).filter((l) => !l.revokedAt && new Date(l.expiresAt) > new Date());
  return (
    <div className="card stack">
      <h2 style={{ fontSize: '1.15rem', margin: 0 }}>
        <Link2 size={18} aria-hidden="true" /> Share tracking with family
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        A private link shows progress and quantities only — no names, addresses or locations. It expires after 7 days and you can turn it off at any time.
      </p>
      {fresh && (
        <Notice tone="warn" title="Copy this link now — it will not be shown again">
          <div className="row">
            <span className="code">{fresh}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigator.clipboard?.writeText(fresh).then(() => toast('Link copied'), () => toast('Could not copy — select the link and copy it manually'))}
            >
              <Copy size={14} /> Copy
            </button>
          </div>
        </Notice>
      )}
      {create.isError && <Notice tone="danger">{create.error.message}</Notice>}
      <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => create.mutate()} disabled={create.isPending}>
        Create a tracking link
      </button>
      {active.length > 0 && (
        <ul className="list small">
          {active.map((l) => (
            <li key={l.id} className="list-item row-between" style={{ padding: '8px 0' }}>
              <span>
                Link created {timeAgo(l.createdAt)} · expires {formatDateTime(l.expiresAt)}
                {l.lastUsedAt ? ` · last opened ${timeAgo(l.lastUsedAt)}` : ' · not opened yet'}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => revoke.mutate(l.id)} disabled={revoke.isPending}>
                Turn off
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// "Done" summary: delivered, hand-over location verified, and confirmed by the recipient.
function CompletionPanel({ request, tracking, onChanged }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => receiptApi.confirm(request.id, note.trim() || undefined),
    onSuccess: () => (toast('Thank you — receipt confirmed'), onChanged()),
  });
  if (!['PARTIALLY_DELIVERED', 'DELIVERED'].includes(request.status)) return null;
  const handovers = (tracking?.dispatches ?? []).map((d) => d.lastHandover).filter(Boolean);
  const verified = handovers.some((h) => h.locationCheck === 'VERIFIED');
  const delivered = request.status === 'DELIVERED';
  const confirmed = Boolean(request.receiptConfirmedAt);
  const step = (ok, label) => (
    <li className={ok ? 'done' : ''}>
      <span aria-hidden="true">{ok ? '✓' : '○'}</span> {label}
    </li>
  );
  return (
    <section className={`card stack ${delivered && verified && confirmed ? 'complete-card' : ''}`} aria-labelledby="done-h">
      <h2 id="done-h" style={{ fontSize: '1.25rem', margin: 0 }}>
        <CheckCircle2 size={18} aria-hidden="true" /> {delivered && confirmed ? 'Done' : 'Delivery check'}
      </h2>
      <ul className="done-steps">
        {step(delivered, delivered ? 'All supplies delivered' : 'Partly delivered so far')}
        {step(verified, verified ? 'Hand-over location verified by the team\'s phone' : 'Hand-over location not verified')}
        {step(confirmed, confirmed ? `Confirmed by the recipient ${formatDateTime(request.receiptConfirmedAt)}` : 'Waiting for the recipient to confirm')}
      </ul>
      {request.receiptNote && <p className="small" style={{ margin: 0 }}>“{request.receiptNote}”</p>}
      {request.isOwn && !confirmed && (
        <div className="stack">
          <Field label="Did you receive these supplies? (optional note)">
            {(a) => <input {...a} className="input" maxLength={500} placeholder="e.g. Received 10 kits, thank you" value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
          <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={m.isPending} onClick={() => m.mutate()}>
            <CheckCircle2 size={16} /> Yes, I received them
          </button>
        </div>
      )}
    </section>
  );
}

export default function RequestDetailPage() {
  const { requestId } = useParams();
  const { user, isStaff } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState(null);
  useLiveRecord('request', requestId);

  const detail = useQuery({ queryKey: ['request', requestId], queryFn: () => requestsApi.get(requestId), refetchInterval: 60000 });
  const tracking = useQuery({
    queryKey: ['tracking', requestId],
    queryFn: () => requestsApi.tracking(requestId),
    // Poll faster while a team is sharing its position on the road.
    refetchInterval: (query) => (query.state.data?.dispatches?.some((d) => d.location?.sharedWithRequester) ? 15000 : 45000),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['request', requestId] });
    qc.invalidateQueries({ queryKey: ['tracking', requestId] });
    qc.invalidateQueries({ queryKey: ['requests'] });
  };

  if (detail.isPending) return <Loading label="Loading request…" />;
  if (detail.isError) return <div className="container section"><ErrorState error={detail.error} onRetry={detail.refetch} /></div>;
  const r = detail.data;
  const t = tracking.data;
  const own = r.isOwn;
  const canCancel = (own && ['SUBMITTED', 'VERIFIED'].includes(r.status)) || (isStaff && ['CAMP_MANAGER', 'RELIEF_COORDINATOR', 'ADMIN'].includes(user.role) && ['SUBMITTED', 'VERIFIED', 'ALLOCATED'].includes(r.status));
  const onTheRoad = (t?.dispatches ?? []).filter((d) => ['IN_TRANSIT', 'PARTIALLY_DELIVERED'].includes(d.status));
  const liveDispatches = onTheRoad.filter((d) => d.location?.latitude != null && (d.location.sharedWithRequester || isStaff));
  // The request-level state stays "team assigned" while the dispatch is moving; show the more specific label.
  const statusLabel = r.status === 'DISPATCHED' && onTheRoad.length ? 'Delivery in progress' : r.statusLabel;
  const canAskEscalation = own && !['DELIVERED', 'REJECTED', 'CANCELLED'].includes(r.status) && user.role === 'CITIZEN';

  return (
    <div className="container">
      <div style={{ paddingTop: 20 }}>
        <Link to={isStaff ? '/ops' : '/track'} className="small">
          <ArrowLeft size={14} aria-hidden="true" /> {isStaff ? 'Back to operations' : 'All my requests'}
        </Link>
      </div>
      <header className="page-head">
        <div className="row-between" style={{ alignItems: 'flex-end' }}>
          <div>
            <div className="eyebrow">{categoryLabel(r.category)} request</div>
            <h1 className="ref-code" style={{ fontSize: '2.1rem' }}>
              {r.referenceCode}
            </h1>
            <div className="row">
              <Badge>{statusLabel}</Badge>
              {isStaff && <SeverityBadge severity={r.severity} prefix="Priority:" />}
              {r.verified && <Badge outline>Verified {timeAgo(r.verifiedAt)}</Badge>}
            </div>
          </div>
          <div className="row">
            {canAskEscalation && (
              <button type="button" className="btn btn-secondary" onClick={() => setDialog('escalate')}>
                <Megaphone size={16} /> Situation got worse
              </button>
            )}
            {canCancel && (
              <button type="button" className="btn btn-danger" onClick={() => setDialog('cancel')}>
                <XCircle size={16} /> Cancel request
              </button>
            )}
          </div>
        </div>
      </header>

      {r.status === 'REJECTED' && <Notice tone="warn" title="This request was not approved">{r.rejectionReason ?? 'Relief staff could not approve this request.'} You can send a new request if your situation has changed.</Notice>}
      {r.status === 'CANCELLED' && <Notice title="This request was cancelled">{r.cancelledReason}</Notice>}

      {liveDispatches.map((d) => (
        <div key={`live-${d.id}`} style={{ marginTop: 16 }}>
          <LiveDeliveryMap
            dispatch={d}
            destination={r.latitude != null ? { latitude: r.latitude, longitude: r.longitude } : r.camp?.latitude != null ? { latitude: r.camp.latitude, longitude: r.camp.longitude } : null}
          />
        </div>
      ))}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', alignItems: 'start', marginTop: 16 }}>
        <div className="stack-lg">
          <section className="card stack" aria-labelledby="progress-h">
            <div className="row-between">
              <h2 id="progress-h" style={{ fontSize: '1.25rem', margin: 0 }}>
                Progress
              </h2>
              {t && <span className="small muted">Last update {timeAgo(t.lastUpdatedAt)}</span>}
            </div>
            <StatusStepper status={r.status} />
            {tracking.isPending && <Loading rows={2} />}
            {tracking.isError && <ErrorState error={tracking.error} onRetry={tracking.refetch} />}
            {t && (
              <>
                {['ALLOCATED', 'DISPATCHED', 'PARTIALLY_DELIVERED'].includes(r.status) && <EtaPanel eta={t.eta} />}
                <ItemsProgress items={t.items} />
              </>
            )}
          </section>

          <CompletionPanel request={r} tracking={t} onChanged={refresh} />

          {t?.dispatches?.length > 0 && (
            <section className="stack" aria-labelledby="deliveries-h">
              <h2 id="deliveries-h" style={{ fontSize: '1.25rem' }}>
                Deliveries
              </h2>
              {t.dispatches.map((d) => (
                <DispatchCard key={d.id} d={d} showExact={isStaff} />
              ))}
            </section>
          )}

          <section className="card" aria-labelledby="details-h">
            <h2 id="details-h" style={{ fontSize: '1.25rem' }}>
              Details
            </h2>
            <dl className="kv">
              <dt>People</dt>
              <dd>
                {r.peopleAffected}
                {r.vulnerableCount != null ? ` (${r.vulnerableCount} especially vulnerable)` : ''}
              </dd>
              <dt>Description</dt>
              <dd style={{ whiteSpace: 'pre-line' }}>{r.description}</dd>
              {r.camp && (
                <>
                  <dt>Camp</dt>
                  <dd>{r.camp.name}</dd>
                </>
              )}
              {r.destinationAddress && (
                <>
                  <dt>Address</dt>
                  <dd>{r.destinationAddress}</dd>
                </>
              )}
              {r.latitude != null && (
                <>
                  <dt>Pinned at</dt>
                  <dd className="code">
                    {r.latitude}, {r.longitude}
                  </dd>
                </>
              )}
              {r.disasterZone && (
                <>
                  <dt>Area</dt>
                  <dd>{r.disasterZone.name}</dd>
                </>
              )}
              {isStaff && r.requester && (
                <>
                  <dt>Requester</dt>
                  <dd>
                    {r.requester.fullName}
                    {r.requester.phone ? ` · ${r.requester.phone}` : ''}
                  </dd>
                </>
              )}
              <dt>Sent</dt>
              <dd>{formatDateTime(r.createdAt)}</dd>
            </dl>
          </section>
        </div>

        <div className="stack-lg">
          {isStaff && (
            <Suspense fallback={<Loading />}>
              <StaffRequestPanel request={r} onChanged={refresh} />
            </Suspense>
          )}
          {(own || ['RELIEF_COORDINATOR', 'ADMIN', 'CAMP_MANAGER'].includes(user.role)) && !['CANCELLED', 'REJECTED'].includes(r.status) && <ShareLinks requestId={r.id} />}
          <section className="card" aria-labelledby="timeline-h">
            <h2 id="timeline-h" style={{ fontSize: '1.25rem' }}>
              Updates
            </h2>
            {t ? <Timeline events={t.timeline} /> : <Loading rows={3} />}
          </section>
          {t?.disclaimer && <Notice>{t.disclaimer}</Notice>}
        </div>
      </div>

      {dialog === 'cancel' && (
        <ReasonDialog
          title="Cancel this request?"
          description="Any reserved supplies will be released for other people. This cannot be undone — you can send a new request later."
          confirmLabel="Cancel request"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await requestsApi.cancel(r.id, reason);
            toast('Request cancelled');
            refresh();
          }}
        />
      )}
      {dialog === 'escalate' && (
        <ReasonDialog
          title="Tell coordinators the situation has got worse"
          description="A relief coordinator will review your message and may raise the priority. If anyone is in immediate danger, call 112 now."
          confirmLabel="Send to coordinators"
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await requestsApi.escalate(r.id, { reason });
            toast('Coordinators have been told');
            refresh();
          }}
        />
      )}
    </div>
  );
}
