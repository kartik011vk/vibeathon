import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, PackageCheck, Play, Radio, ThumbsUp } from 'lucide-react';
import { dispatchesApi, placesApi, teamsApi, trackingApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/Toast.jsx';
import { useLiveLocation } from '../../hooks/useLiveLocation.js';
import { Badge, Dialog, EmptyState, ErrorState, Field, Loading, Notice, PageHead, ReasonDialog, SeverityBadge, Tabs } from '../../components/ui/index.jsx';
import { categoryLabel, DISPATCH_STATUS, formatDateTime, num, timeAgo } from '../../lib/format.js';
import { EtaPanel } from '../tracking/TrackingParts.jsx';

const LeafletMap = lazy(() => import('../../components/map/LeafletMap.jsx'));
const OPEN = ['ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'];

function toLocalInput(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function EtaDialog({ d, onClose, onDone }) {
  const [when, setWhen] = useState(toLocalInput(d.eta?.eta ?? Date.now() + 60 * 60000));
  const [reason, setReason] = useState('');
  const [unknown, setUnknown] = useState(false);
  const m = useMutation({
    mutationFn: () => dispatchesApi.setEta(d.id, { eta: unknown ? null : new Date(when).toISOString(), reason: reason.trim() }),
    onSuccess: () => (onDone(), onClose()),
  });
  return (
    <Dialog title="Update estimated arrival" onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
        <p className="small muted">The requester sees this as an estimate. Big changes notify them automatically.</p>
        <label className="checkbox">
          <input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} />
          <span>I cannot estimate an arrival time right now</span>
        </label>
        {!unknown && <Field label="Expected arrival">{(a) => <input {...a} className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>}
        <Field label="Reason" hint="e.g. 'Loaded, leaving now', 'Road blocked at bridge, rerouting'">
          {(a) => <input {...a} className="input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        {m.isError && <Notice tone="danger">{m.error.fieldErrors?.().eta ?? m.error.message}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button className="btn btn-primary" disabled={m.isPending || reason.trim().length < 3}>
            Save estimate
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DeliveryDialog({ d, onClose, onDone }) {
  const [qty, setQty] = useState(() => Object.fromEntries(d.lines.map((l) => [l.id, l.remainingQuantity])));
  const [notes, setNotes] = useState('');
  const m = useMutation({
    mutationFn: (final) =>
      dispatchesApi.complete(d.id, {
        lines: d.lines.map((l) => ({ dispatchLineId: l.id, quantity: Number(qty[l.id] || 0) })).filter((l) => l.quantity > 0),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        final,
      }),
    onSuccess: () => (onDone(), onClose()),
  });
  const total = d.lines.reduce((s, l) => s + Number(qty[l.id] || 0), 0);
  const remainingAfter = d.lines.reduce((s, l) => s + l.remainingQuantity - Number(qty[l.id] || 0), 0);
  const invalid = d.lines.some((l) => Number(qty[l.id]) > l.remainingQuantity || Number(qty[l.id]) < 0);
  return (
    <Dialog title="Record hand-over" onClose={onClose}>
      <div className="stack">
        <p className="small muted">Enter what was actually handed over just now. Partial amounts are fine — the remainder stays on this delivery.</p>
        {d.lines.map((l) => (
          <Field key={l.id} label={`${l.item.name}`} hint={`${l.remainingQuantity} ${l.item.unit} still to hand over (of ${l.quantity})`}>
            {(a) => <input {...a} className="input" type="number" min="0" max={l.remainingQuantity} value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />}
          </Field>
        ))}
        <Field label="Notes (optional)">{(a) => <input {...a} className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {remainingAfter > 0 && <Notice>Finishing the run now returns the {remainingAfter} undelivered units to available stock, and coordinators can plan another delivery.</Notice>}
        {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          {remainingAfter > 0 && (
            <button type="button" className="btn btn-secondary" disabled={m.isPending || invalid || total === 0} onClick={() => m.mutate(false)}>
              Save partial delivery
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={m.isPending || invalid} onClick={() => m.mutate(true)}>
            {remainingAfter > 0 ? 'Save and finish run' : 'Confirm full delivery'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function EtaHistory({ id }) {
  const q = useQuery({ queryKey: ['dispatch-tracking', id], queryFn: () => trackingApi.dispatch(id) });
  if (q.isPending) return <Loading rows={1} />;
  if (q.isError) return <ErrorState error={q.error} />;
  if (!q.data.etaHistory.length) return <p className="small muted">No arrival estimates recorded yet.</p>;
  return (
    <ul className="list small">
      {q.data.etaHistory
        .slice()
        .reverse()
        .map((h) => (
          <li key={h.createdAt} className="list-item" style={{ padding: '6px 0' }}>
            {h.available ? `ETA ${formatDateTime(h.newEta)}` : 'Marked unavailable'}
            {h.previousEta ? ` (was ${formatDateTime(h.previousEta)})` : ''} · {h.reason} · {h.actor?.fullName ?? h.actor?.role ?? ''} · {timeAgo(h.createdAt)}
          </li>
        ))}
    </ul>
  );
}

function DispatchWork({ d, isTeam, isCoordinator }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dialog, setDialog] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const done = (msg) => {
    if (msg) toast(msg);
    qc.invalidateQueries({ queryKey: ['dispatches'] });
    qc.invalidateQueries({ queryKey: ['dispatch-tracking', d.id] });
    qc.invalidateQueries({ queryKey: ['teams'] });
  };
  const act = useMutation({ mutationFn: (fn) => fn(), onSuccess: () => done() });
  const moving = ['IN_TRANSIT', 'PARTIALLY_DELIVERED'].includes(d.status);
  const live = useLiveLocation(async (pos) => {
    await dispatchesApi.updateLocation(d.id, pos);
    qc.invalidateQueries({ queryKey: ['dispatches'] });
  }, ['ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'].includes(d.status));
  const open = OPEN.includes(d.status);
  return (
    <article className="card stack">
      <div className="row-between">
        <div className="row">
          <Link to={`/requests/${d.request.id}`} className="code">
            {d.request.referenceCode}
          </Link>
          <strong>{categoryLabel(d.request.category)}</strong>
          <SeverityBadge severity={d.request.severity} />
        </div>
        <Badge>{DISPATCH_STATUS[d.status]}</Badge>
      </div>
      <dl className="kv small">
        <dt>Team</dt>
        <dd>{d.team?.name}</dd>
        <dt>Collect from</dt>
        <dd>{d.source?.name ?? '—'}</dd>
        <dt>Deliver to</dt>
        <dd>
          {d.request.camp?.name ?? d.request.destinationAddress ?? 'See request'}
          {d.request.camp && d.request.destinationAddress ? ` · ${d.request.destinationAddress}` : ''}
        </dd>
        {d.notes && (
          <>
            <dt>Notes</dt>
            <dd>{d.notes}</dd>
          </>
        )}
      </dl>
      <ul className="list small">
        {d.lines.map((l) => (
          <li key={l.id} className="list-item row-between" style={{ padding: '6px 0' }}>
            <span>{l.item.name}</span>
            <span>
              {num(l.deliveredQuantity)} / {num(l.quantity)} {l.item.unit} handed over
            </span>
          </li>
        ))}
      </ul>
      {open && <EtaPanel eta={d.eta} />}
      {open && d.status !== 'ASSIGNED' && (
        <div className="small muted">
          {d.location.available ? `Position last shared ${timeAgo(d.location.updatedAt)}${d.location.stale ? ' — out of date' : ''}` : 'No position shared yet.'}
          {d.location.approxDistanceToDestinationKm != null && ` · approx. ${d.location.approxDistanceToDestinationKm} km straight-line to destination`}
        </div>
      )}
      {open && (
        <div className="row">
          {isTeam && d.status === 'ASSIGNED' && (
            <button type="button" className="btn btn-primary btn-sm" disabled={act.isPending} onClick={() => act.mutate(() => dispatchesApi.accept(d.id))}>
              <ThumbsUp size={16} /> Accept delivery
            </button>
          )}
          {(isTeam || isCoordinator) && d.status === 'ACCEPTED' && (
            <button type="button" className="btn btn-primary btn-sm" disabled={act.isPending} onClick={() => act.mutate(() => dispatchesApi.start(d.id))}>
              <Play size={16} /> Start delivery
            </button>
          )}
          {(isTeam || isCoordinator) && moving && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog('deliver')}>
              <PackageCheck size={16} /> Record hand-over
            </button>
          )}
          {isTeam && d.status !== 'ASSIGNED' && (
            <button
              type="button"
              className={`btn btn-sm ${live.sharing ? 'btn-amber' : 'btn-secondary'}`}
              aria-pressed={live.sharing}
              onClick={() => (live.sharing ? live.stop() : live.start())}
              title="Coordinators always see it; the family sees it on a map once you start the delivery"
            >
              <Radio size={16} /> {live.sharing ? 'Stop sharing location' : 'Share live location'}
            </button>
          )}
          {(isTeam || isCoordinator) && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('eta')}>
              <Clock size={16} /> Arrival estimate
            </button>
          )}
          {(isTeam || isCoordinator) && d.status !== 'ASSIGNED' && (
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setDialog('fail')}>
              Cannot complete
            </button>
          )}
          {isCoordinator && ['ASSIGNED', 'ACCEPTED'].includes(d.status) && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('cancel')}>
              Cancel dispatch
            </button>
          )}
        </div>
      )}
      {live.sharing && (
        <Notice icon={Radio} title="Sharing your live location">
          {live.lastSentAt ? `Last sent ${timeAgo(live.lastSentAt)}${live.lastAccuracy ? `, accurate to about ${live.lastAccuracy} m` : ''}.` : 'Waiting for the first GPS fix…'}
          {live.lastAccuracy > 100 ? ' The signal is weak — step outside or away from buildings for a better fix.' : ''} {moving ? 'The family can see your position on their map.' : 'The family will see it once you start the delivery.'} Keep this page open while you drive.
        </Notice>
      )}
      {live.error && <Notice tone="warn">{live.error} You can still update the arrival estimate.</Notice>}
      {act.isError && <Notice tone="danger">{act.error.message}</Notice>}
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
        {showHistory ? 'Hide' : 'Show'} arrival-estimate history
      </button>
      {showHistory && <EtaHistory id={d.id} />}

      {dialog === 'eta' && <EtaDialog d={d} onClose={() => setDialog(null)} onDone={() => done('Arrival estimate saved')} />}
      {dialog === 'deliver' && <DeliveryDialog d={d} onClose={() => setDialog(null)} onDone={() => done('Hand-over recorded')} />}
      {dialog === 'fail' && (
        <ReasonDialog
          title="Delivery cannot be completed"
          description="Undelivered stock is released and coordinators are alerted to re-plan. Anything already handed over stays recorded."
          confirmLabel="Mark as not completed"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => (await dispatchesApi.fail(d.id, reason), done('Coordinators informed'))}
        />
      )}
      {dialog === 'cancel' && (
        <ReasonDialog
          title="Cancel dispatch"
          description="The reserved stock stays reserved so you can assign another team."
          confirmLabel="Cancel dispatch"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => (await dispatchesApi.cancel(d.id, reason), done('Dispatch cancelled'))}
        />
      )}
    </article>
  );
}

function TeamPanel() {
  const { user, hasRole } = useAuth();
  const qc = useQueryClient();
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => teamsApi.list() });
  const setAvail = useMutation({ mutationFn: ({ id, a }) => teamsApi.setAvailability(id, a), onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }) });
  const positions = useQuery({ queryKey: ['map', 'teams'], queryFn: placesApi.mapTeams, enabled: hasRole('RELIEF_COORDINATOR', 'ADMIN', 'RESPONSE_TEAM') });
  if (teams.isPending) return <Loading rows={2} />;
  if (teams.isError) return <ErrorState error={teams.error} onRetry={teams.refetch} />;
  return (
    <div className="stack">
      <div className="grid grid-3">
        {teams.data.map((t) => {
          const mine = user.teams?.some((x) => x.id === t.id);
          return (
            <div key={t.id} className="card card-tight stack">
              <div className="row-between">
                <strong>{t.name}</strong>
                <Badge>{t.availability.replace('_', ' ').toLowerCase()}</Badge>
              </div>
              <span className="small muted">
                {t.callSign ? `${t.callSign} · ` : ''}
                {t.memberCount} member{t.memberCount === 1 ? '' : 's'}
                {t.baseLocation ? ` · based at ${t.baseLocation.name}` : ''}
              </span>
              {t.location?.available ? (
                <span className="small">
                  Position {timeAgo(t.location.updatedAt)}
                  {t.location.stale ? ' (out of date)' : ''}
                </span>
              ) : (
                t.location?.restricted ? null : <span className="small muted">No position shared</span>
              )}
              {(mine || hasRole('RELIEF_COORDINATOR', 'ADMIN')) && (
                <select className="input" aria-label={`Availability of ${t.name}`} value={t.availability} onChange={(e) => setAvail.mutate({ id: t.id, a: e.target.value })}>
                  <option value="AVAILABLE">Available</option>
                  <option value="BUSY">Busy</option>
                  <option value="OFF_DUTY">Off duty</option>
                </select>
              )}
            </div>
          );
        })}
      </div>
      {positions.data && positions.data.length > 0 && (
        <Suspense fallback={<Loading />}>
          <LeafletMap
            label="Team positions"
            markers={positions.data.map((t) => ({ id: t.id, latitude: t.latitude, longitude: t.longitude, kind: 'team', title: t.name, popup: <span>{t.name} · {t.stale ? 'out of date' : `reported ${timeAgo(t.updatedAt)}`}</span> }))}
          />
        </Suspense>
      )}
      {positions.data && positions.data.length === 0 && <p className="small muted">No team has shared a position yet. Positions are never estimated.</p>}
    </div>
  );
}

export default function DispatchPage() {
  const { hasRole } = useAuth();
  const isTeam = hasRole('RESPONSE_TEAM');
  const isCoordinator = hasRole('RELIEF_COORDINATOR', 'ADMIN');
  const [tab, setTab] = useState('active');
  const q = useQuery({
    queryKey: ['dispatches', tab],
    queryFn: () => dispatchesApi.list(tab === 'active' ? { active: true, pageSize: 50, sortBy: 'updatedAt' } : { status: 'DELIVERED,FAILED,CANCELLED', pageSize: 30, sortBy: 'updatedAt' }),
    refetchInterval: 30000,
  });
  return (
    <div>
      <PageHead eyebrow="Operations" title={isTeam ? 'My deliveries' : 'Dispatch board'}>
        {isTeam ? 'Accept, start and record each delivery. Share your position only while delivering.' : 'Every delivery in progress, with its latest estimate and position freshness.'}
      </PageHead>
      <Tabs
        label="Dispatch views"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'active', label: 'In progress' },
          { value: 'closed', label: 'Finished' },
          { value: 'teams', label: 'Teams' },
        ]}
      />
      {tab === 'teams' ? (
        <TeamPanel />
      ) : (
        <>
          {q.isPending && <Loading rows={3} />}
          {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
          {q.data && q.data.data.length === 0 && (
            <EmptyState title={tab === 'active' ? 'No deliveries in progress' : 'No finished deliveries yet'}>
              {isTeam && tab === 'active' ? 'New assignments appear here and in your notifications.' : null}
            </EmptyState>
          )}
          <div className="stack">
            {q.data?.data.map((d) => (
              <DispatchWork key={d.id} d={d} isTeam={isTeam} isCoordinator={isCoordinator} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
