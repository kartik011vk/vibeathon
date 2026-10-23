// Responder board: verified requests that still need someone to deliver them.
import { lazy, Suspense, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandHeart, Undo2 } from 'lucide-react';
import { offersApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/Toast.jsx';
import { useGeolocation } from '../../hooks/useGeolocation.js';
import { Badge, Dialog, EmptyState, ErrorState, Field, Loading, Notice, PageHead, SeverityBadge } from '../../components/ui/index.jsx';
import { categoryLabel, CATEGORIES, distanceLabel, num, REQUEST_STATUS, timeAgo } from '../../lib/format.js';

const LeafletMap = lazy(() => import('../../components/map/LeafletMap.jsx'));

function OfferDialog({ need, onClose }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [teamId, setTeamId] = useState(user.teams?.[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [ownSupplies, setOwnSupplies] = useState(false);
  const m = useMutation({
    mutationFn: () => offersApi.create(need.id, { teamId, ...(note.trim() ? { note: note.trim() } : {}), ownSupplies }),
    onSuccess: () => {
      toast('Offer sent to coordinators');
      qc.invalidateQueries({ queryKey: ['open-needs'] });
      onClose();
    },
  });
  return (
    <Dialog title={`Offer to deliver ${need.referenceCode}`} onClose={onClose}>
      <div className="stack">
        <p className="small muted">A relief coordinator reviews offers and assigns the delivery. You will get a notification and the job appears in Dispatch.</p>
        {user.teams?.length > 1 && (
          <Field label="Team">
            {(a) => (
              <select {...a} className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                {user.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label="Message for the coordinator (optional)" hint="Vehicle, when you can go, how many people">
          {(a) => <textarea {...a} className="input" style={{ minHeight: 80 }} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={ownSupplies} onChange={(e) => setOwnSupplies(e.target.checked)} />
          <span>We can bring some of these supplies ourselves</span>
        </label>
        {!teamId && <Notice tone="warn">Your account is not on a team yet.</Notice>}
        {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button type="button" className="btn btn-primary" disabled={!teamId || m.isPending} onClick={() => m.mutate()}>
            Send offer
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export default function OpenNeedsPage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const geo = useGeolocation();
  const [category, setCategory] = useState('');
  const [offering, setOffering] = useState(null);
  const origin = geo.position;
  const q = useQuery({
    queryKey: ['open-needs', category, origin?.latitude, origin?.longitude],
    queryFn: () => offersApi.openNeeds({ category: category || undefined, latitude: origin?.latitude, longitude: origin?.longitude }),
    refetchInterval: 45000,
  });
  const offers = useQuery({
    queryKey: ['open-needs', 'my-offers', q.data?.data.filter((n) => n.offeredByMyTeam).map((n) => n.id).join(',')],
    queryFn: async () => {
      const mine = q.data.data.filter((n) => n.offeredByMyTeam);
      const lists = await Promise.all(mine.map((n) => offersApi.list(n.id)));
      return Object.fromEntries(mine.map((n, i) => [n.id, lists[i].find((o) => o.status === 'OPEN')]));
    },
    enabled: Boolean(q.data && hasRole('RESPONSE_TEAM')),
  });
  const withdraw = useMutation({
    mutationFn: ({ requestId, offerId }) => offersApi.withdraw(requestId, offerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['open-needs'] }),
  });
  const isTeam = hasRole('RESPONSE_TEAM');
  const needs = q.data?.data ?? [];

  return (
    <div>
      <PageHead eyebrow="Operations" title="Open needs">
        Verified requests that nobody is delivering yet, highest priority first. Requester names, phone numbers and exact addresses are shared only with the team that is assigned.
      </PageHead>
      <div className="stack">
        <div className="row">
          <select className="input" style={{ width: 'auto' }} aria-label="Supply type" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All supplies</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => geo.request()} disabled={geo.status === 'locating'}>
            {geo.status === 'locating' ? 'Finding you…' : 'Measure from my current position'}
          </button>
          {q.data?.meta.origin && <span className="small muted">Distances from {origin ? 'your current position' : q.data.meta.origin.label}, straight-line.</span>}
        </div>
        {geo.error && <Notice tone="warn">{geo.error.replace('choose your location manually below', 'distances are measured from your team base instead')}</Notice>}

        {needs.some((n) => n.approximateLocation) && (
          <Suspense fallback={<Loading />}>
            <LeafletMap
              label="Map of open needs"
              you={origin}
              markers={needs
                .filter((n) => n.approximateLocation)
                .map((n) => ({
                  id: n.id,
                  ...n.approximateLocation,
                  kind: 'request',
                  title: n.referenceCode,
                  popup: (
                    <div>
                      <strong>{n.referenceCode}</strong> · {categoryLabel(n.category)}
                      <div>{n.peopleAffected} people · {n.severityLabel}</div>
                      <div>{n.locationPrecision === 'CAMP' ? 'At the camp' : 'Approximate area (about 1 km)'}</div>
                    </div>
                  ),
                }))}
              fallbackCenter={[30.3, 78.05]}
              fallbackZoom={9}
            />
          </Suspense>
        )}

        {q.isPending && <Loading rows={4} />}
        {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
        {q.data && needs.length === 0 && <EmptyState title="No open needs right now">Every verified request has a team on the way. New requests appear here as soon as staff verify them.</EmptyState>}
        {needs.map((n) => {
          const myOffer = offers.data?.[n.id];
          return (
            <article key={n.id} className="card">
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="row">
                    <span className="code">{n.referenceCode}</span>
                    <strong>{categoryLabel(n.category)}</strong>
                    <SeverityBadge severity={n.severity} />
                    {n.suppliesReserved && <Badge className="avail-AVAILABLE">Supplies reserved</Badge>}
                  </div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {n.area ?? 'Area not given'} · {n.peopleAffected} people{n.vulnerableCount ? ` (${n.vulnerableCount} vulnerable)` : ''} · {REQUEST_STATUS[n.status]} · waiting {timeAgo(n.createdAt).replace(' ago', '')}
                  </div>
                </div>
                <span className="badge badge-outline">{distanceLabel(n.distanceKm)}</span>
              </div>
              <ul className="small" style={{ margin: '10px 0' }}>
                {n.items.map((i) => (
                  <li key={i.name}>
                    {num(i.remaining)} {i.unit} — {i.name}
                  </li>
                ))}
              </ul>
              <div className="row">
                {isTeam && !n.offeredByMyTeam && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setOffering(n)}>
                    <HandHeart size={16} /> Offer to deliver
                  </button>
                )}
                {isTeam && n.offeredByMyTeam && (
                  <>
                    <Badge className="sev-HIGH">Your team offered — waiting for a coordinator</Badge>
                    {myOffer && (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={withdraw.isPending} onClick={() => withdraw.mutate({ requestId: n.id, offerId: myOffer.id })}>
                        <Undo2 size={14} /> Withdraw
                      </button>
                    )}
                  </>
                )}
                {n.offersCount > 0 && <span className="small muted">{n.offersCount} team{n.offersCount > 1 ? 's have' : ' has'} offered</span>}
                {!isTeam && (
                  <a href={`/requests/${n.id}`} className="btn btn-secondary btn-sm">
                    Open request
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {offering && <OfferDialog need={offering} onClose={() => setOffering(null)} />}
    </div>
  );
}
