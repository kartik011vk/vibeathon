import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Crosshair, Gift, PackageCheck, Plus, Trash2, Truck, Warehouse } from 'lucide-react';
import { inventoryApi, suppliesApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/Toast.jsx';
import { useGeolocation } from '../../hooks/useGeolocation.js';
import { Badge, Dialog, EmptyState, ErrorState, Field, Loading, Notice, PageHead, ReasonDialog, Tabs } from '../../components/ui/index.jsx';
import { categoryLabel, formatDateTime, LOCATION_TYPES, num, timeAgo } from '../../lib/format.js';
import { Timeline } from '../tracking/TrackingParts.jsx';

const LeafletMap = lazy(() => import('../../components/map/LeafletMap.jsx'));

export const DONATION_STATUS = {
  PENDING: ['Waiting for review', 'sev-HIGH'],
  ACCEPTED: ['Accepted — on its way to stock', 'avail-LIMITED'],
  RECEIVED: ['Received into stock', 'avail-AVAILABLE'],
  REJECTED: ['Not accepted', 'sev-RED'],
  CANCELLED: ['Withdrawn', ''],
};

function StatusBadge({ status }) {
  const [label, cls] = DONATION_STATUS[status];
  return <Badge className={cls}>{label}</Badge>;
}

export function DonatePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const geo = useGeolocation();
  const catalogue = useQuery({ queryKey: ['inventory', 'catalogue', 'all'], queryFn: () => inventoryApi.catalogue() });
  const [donorName, setDonorName] = useState(user.organization?.name ?? user.fullName);
  const [lines, setLines] = useState([{ inventoryItemId: '', name: '', unit: '', quantity: '' }]);
  const [mode, setMode] = useState('DROP_OFF');
  const [pickupAddress, setPickupAddress] = useState('');
  const [point, setPoint] = useState(null);
  const [availableFrom, setAvailableFrom] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (geo.status === 'ready') setPoint(geo.position);
  }, [geo.status, geo.position]);

  const m = useMutation({
    mutationFn: suppliesApi.create,
    onSuccess: (offer) => {
      qc.invalidateQueries({ queryKey: ['donations'] });
      navigate(`/donations/${offer.id}`, { replace: true, state: { created: true } });
    },
  });

  const byCategory = useMemo(() => {
    const groups = {};
    for (const i of catalogue.data?.data ?? []) (groups[i.category] ??= []).push(i);
    return groups;
  }, [catalogue.data]);

  const setLine = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const submit = (e) => {
    e.preventDefault();
    const v = {};
    const clean = lines.filter((l) => Number(l.quantity) > 0 && (l.inventoryItemId || (l.name.trim() && l.unit.trim())));
    if (!clean.length) v.lines = 'Add at least one item with a quantity.';
    if (lines.some((l) => l.inventoryItemId === 'OTHER' && Number(l.quantity) > 0 && !(l.name.trim() && l.unit.trim()))) v.lines = 'Give a name and unit for items not in the list.';
    if (mode === 'PICKUP' && pickupAddress.trim().length < 5) v.pickupAddress = 'Where should a team collect from?';
    if (donorName.trim().length < 2) v.donorName = 'Who is donating?';
    setErrors(v);
    if (Object.keys(v).length || m.isPending) return;
    m.mutate({
      donorName: donorName.trim(),
      deliveryMode: mode,
      ...(mode === 'PICKUP' ? { pickupAddress: pickupAddress.trim() } : {}),
      ...(mode === 'PICKUP' && point ? { latitude: point.latitude, longitude: point.longitude } : {}),
      ...(availableFrom ? { availableFrom: new Date(availableFrom).toISOString() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      lines: clean.map((l) =>
        l.inventoryItemId && l.inventoryItemId !== 'OTHER' ? { inventoryItemId: l.inventoryItemId, quantity: Number(l.quantity) } : { name: l.name.trim(), unit: l.unit.trim(), quantity: Number(l.quantity) },
      ),
    });
  };

  return (
    <div className="container" style={{ maxWidth: 880 }}>
      <PageHead eyebrow="Donate supplies" title="Give food, water, medicine or shelter">
        Tell us what you can give. Relief staff check what is needed and tell you where to bring it — or arrange collection. You can follow your donation until it is counted into stock.
      </PageHead>
      <form className="stack-lg" onSubmit={submit} noValidate>
        <div className="card stack">
          <Field label="Donating as" hint="Your name, shop, company or organisation" error={errors.donorName}>
            {(a) => <input {...a} className="input" value={donorName} maxLength={120} onChange={(e) => setDonorName(e.target.value)} />}
          </Field>
          <span className="label">What can you give?</span>
          {catalogue.isPending && <Loading rows={1} />}
          {catalogue.isError && <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />}
          {lines.map((l, idx) => (
            <div key={idx} className="row" style={{ alignItems: 'flex-end' }}>
              <Field label={`Item ${idx + 1}`}>
                {(a) => (
                  <select {...a} className="input" style={{ minWidth: 240 }} value={l.inventoryItemId} onChange={(e) => setLine(idx, { inventoryItemId: e.target.value })}>
                    <option value="">Choose…</option>
                    {Object.entries(byCategory).map(([cat, items]) => (
                      <optgroup key={cat} label={categoryLabel(cat)}>
                        {items.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} ({i.unit})
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <option value="OTHER">Something not in this list…</option>
                  </select>
                )}
              </Field>
              {l.inventoryItemId === 'OTHER' && (
                <>
                  <Field label="Name">{(a) => <input {...a} className="input" value={l.name} onChange={(e) => setLine(idx, { name: e.target.value })} />}</Field>
                  <Field label="Unit">{(a) => <input {...a} className="input" style={{ width: 110 }} placeholder="packs" value={l.unit} onChange={(e) => setLine(idx, { unit: e.target.value })} />}</Field>
                </>
              )}
              <Field label="Quantity">{(a) => <input {...a} className="input" style={{ width: 110 }} type="number" min="1" value={l.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} />}</Field>
              {lines.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove item ${idx + 1}`} onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
          {errors.lines && <span className="field-error">{errors.lines}</span>}
          <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setLines((ls) => [...ls, { inventoryItemId: '', name: '', unit: '', quantity: '' }])}>
            <Plus size={16} /> Add another item
          </button>
        </div>

        <div className="card stack">
          <span className="label">How will the supplies reach us?</span>
          <div className="choice-grid" role="radiogroup" aria-label="Delivery">
            {[
              ['DROP_OFF', Warehouse, 'I can drop them off', 'Staff will tell you which warehouse or camp to bring them to.'],
              ['PICKUP', Truck, 'Please collect them', 'A team collects from your address when possible.'],
            ].map(([value, Icon, title, body]) => (
              <button key={value} type="button" role="radio" aria-checked={mode === value} className="choice" onClick={() => setMode(value)}>
                <span className="choice-icon">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <strong>{title}</strong>
                <span className="small muted">{body}</span>
              </button>
            ))}
          </div>
          {mode === 'PICKUP' && (
            <>
              <Field label="Collection address" error={errors.pickupAddress}>
                {(a) => <input {...a} className="input" maxLength={300} value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} />}
              </Field>
              <div className="row">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => geo.request()} disabled={geo.status === 'locating'}>
                  <Crosshair size={16} /> {geo.status === 'locating' ? 'Finding you…' : 'Use my location for the pin'}
                </button>
                {point && <span className="small">Pin set at {point.latitude}, {point.longitude}</span>}
              </div>
              {geo.error && <Notice tone="warn">{geo.error.replace('below', 'on the map')}</Notice>}
              <Suspense fallback={<Loading />}>
                <LeafletMap label="Pick the collection point" you={point} onPick={setPoint} fallbackCenter={[30.32, 78.03]} fallbackZoom={11} />
              </Suspense>
            </>
          )}
          <div className="grid grid-2">
            <Field label="Available from (optional)">{(a) => <input {...a} className="input" type="datetime-local" value={availableFrom} onChange={(e) => setAvailableFrom(e.target.value)} />}</Field>
            <Field label="Anything else? (optional)" hint="Expiry dates, packaging, loading help…">
              {(a) => <input {...a} className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          </div>
        </div>
        <Notice>Your offer is not counted as stock until it arrives and is counted at the warehouse or camp, so people are never promised supplies that have not arrived.</Notice>
        {m.isError && <Notice tone="danger" title="Your offer was not sent">{m.error.message}</Notice>}
        <button className="btn btn-primary btn-lg" style={{ alignSelf: 'flex-start' }} disabled={m.isPending}>
          <Gift size={18} /> {m.isPending ? 'Sending…' : 'Send offer'}
        </button>
      </form>
    </div>
  );
}

export function MyDonationsPage() {
  const q = useQuery({ queryKey: ['donations', 'mine'], queryFn: () => suppliesApi.list({ mine: true, pageSize: 50 }), refetchInterval: 60000 });
  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <PageHead
        eyebrow="Donate supplies"
        title="My donations"
        actions={
          <Link to="/donate" className="btn btn-primary">
            <Gift size={16} /> New donation
          </Link>
        }
      />
      {q.isPending && <Loading rows={3} />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && q.data.data.length === 0 && <EmptyState title="No donations yet" action={<Link to="/donate" className="btn btn-primary">Offer supplies</Link>} />}
      <div className="stack">
        {q.data?.data.map((o) => (
          <Link key={o.id} to={`/donations/${o.id}`} className="card card-tight" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="row-between">
              <span>
                <span className="code">{o.referenceCode}</span> <strong>{o.lines.map((l) => `${num(l.quantity)} ${l.unit} ${l.name}`).join(', ')}</strong>
              </span>
              <StatusBadge status={o.status} />
            </div>
            <div className="small muted">Offered {formatDateTime(o.createdAt)}{o.receivingLocation ? ` · going to ${o.receivingLocation.name}` : ''}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

const STEPS = [
  ['PENDING', 'Offered'],
  ['ACCEPTED', 'Accepted'],
  ['RECEIVED', 'Received into stock'],
];

export function DonationDetailPage() {
  const { offerId } = useParams();
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const q = useQuery({ queryKey: ['donations', offerId], queryFn: () => suppliesApi.get(offerId), refetchInterval: 30000 });
  if (q.isPending) return <Loading />;
  if (q.isError) return <div className="container section"><ErrorState error={q.error} onRetry={q.refetch} /></div>;
  const o = q.data;
  const at = o.status === 'RECEIVED' ? 2 : o.status === 'ACCEPTED' ? 1 : 0;
  const closed = ['REJECTED', 'CANCELLED'].includes(o.status);
  const loc = o.receivingLocation;
  return (
    <div className="container" style={{ maxWidth: 900 }}>
      <header className="page-head">
        <div className="eyebrow">Donation from {o.donorName}</div>
        <h1 className="ref-code" style={{ fontSize: '2rem' }}>
          {o.referenceCode}
        </h1>
        <div className="row">
          <StatusBadge status={o.status} />
          <Badge outline>{o.deliveryMode === 'PICKUP' ? 'Collection requested' : 'Drop-off'}</Badge>
        </div>
      </header>
      {!closed && (
        <ol className="steps" aria-label="Donation progress">
          {STEPS.map(([, label], i) => (
            <li key={label} className={i < at || (i === at && o.status === 'RECEIVED') ? 'done' : i === at ? 'current' : ''}>
              {label}
            </li>
          ))}
        </ol>
      )}
      {o.status === 'ACCEPTED' && loc && (
        <Notice icon={Warehouse} title={o.deliveryMode === 'DROP_OFF' ? `Please bring it to ${loc.name}` : `A team will collect it and take it to ${loc.name}`}>
          {loc.address ?? loc.area}
          {o.decisionNote ? ` · ${o.decisionNote}` : ''}
        </Notice>
      )}
      {o.status === 'RECEIVED' && (
        <Notice icon={Check} title={`Thank you — counted into stock at ${loc?.name} ${timeAgo(o.receivedAt)}`}>
          {o.impact && o.impact.deliveriesSinceArrival > 0
            ? `Since your donation arrived, ${o.impact.deliveriesSinceArrival} deliveries from ${loc?.name} have reached ${o.impact.requestsServedSinceArrival} requests covering ${o.impact.peopleInThoseRequests} people.`
            : `No deliveries have left ${loc?.name} since your donation arrived yet. This updates automatically.`}
          {o.impact && <div className="small muted">{o.impact.note}</div>}
        </Notice>
      )}
      {o.status === 'REJECTED' && <Notice tone="warn" title="This offer was not accepted">{o.decisionNote}</Notice>}
      <div className="grid grid-2" style={{ marginTop: 20, alignItems: 'start' }}>
        <div className="card">
          <h2 style={{ fontSize: '1.2rem' }}>Items</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="num">Offered</th>
                  <th scope="col" className="num">Received</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.name}
                      {l.offeredName !== l.name && <div className="small muted">offered as “{l.offeredName}”</div>}
                    </td>
                    <td className="num">
                      {num(l.quantity)} {l.unit}
                    </td>
                    <td className="num">{l.receivedQuantity == null ? '—' : `${num(l.receivedQuantity)} ${l.unit}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {o.isOwn && ['PENDING', 'ACCEPTED'].includes(o.status) && (
            <button type="button" className="btn btn-danger btn-sm" style={{ marginTop: 12 }} onClick={() => setCancelling(true)}>
              Withdraw offer
            </button>
          )}
        </div>
        <div className="card">
          <h2 style={{ fontSize: '1.2rem' }}>Updates</h2>
          <Timeline events={o.events.map((e, i) => ({ id: i, message: e.message, createdAt: e.createdAt }))} />
        </div>
      </div>
      {loc?.latitude != null && (
        <div style={{ marginTop: 20 }}>
          <Suspense fallback={<Loading />}>
            <LeafletMap label="Receiving location" markers={[{ id: loc.id, latitude: loc.latitude, longitude: loc.longitude, kind: 'resource', title: loc.name, popup: <strong>{loc.name}</strong> }]} />
          </Suspense>
        </div>
      )}
      {cancelling && (
        <ReasonDialog title="Withdraw this offer?" confirmLabel="Withdraw" tone="danger" onClose={() => setCancelling(false)} onConfirm={async (r) => (await suppliesApi.cancel(o.id, r), toast('Offer withdrawn'), q.refetch())} />
      )}
    </div>
  );
}

function AcceptDialog({ offer, onClose, onDone }) {
  const { user } = useAuth();
  const locations = useQuery({ queryKey: ['inventory', 'locations'], queryFn: inventoryApi.locations });
  const catalogue = useQuery({ queryKey: ['inventory', 'catalogue', 'all'], queryFn: () => inventoryApi.catalogue() });
  const [locationId, setLocationId] = useState('');
  const [note, setNote] = useState('');
  const [map, setMap] = useState({});
  const choices = (locations.data ?? []).filter((l) => user.role !== 'INVENTORY_MANAGER' || l.assignedToMe);
  const unmapped = offer.lines.filter((l) => !l.inventoryItemId);
  const m = useMutation({
    mutationFn: () => suppliesApi.accept(offer.id, { receivingLocationId: locationId, ...(note.trim() ? { note: note.trim() } : {}), lines: Object.entries(map).map(([lineId, inventoryItemId]) => ({ lineId, inventoryItemId })) }),
    onSuccess: () => (onDone('Offer accepted — the donor has been told where to go'), onClose()),
  });
  return (
    <Dialog title={`Accept ${offer.referenceCode}`} onClose={onClose}>
      <div className="stack">
        <Field label="Receive into">
          {(a) => (
            <select {...a} className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Choose a stock location…</option>
              {choices.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} — {LOCATION_TYPES[l.type]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {unmapped.map((l) => (
          <Field key={l.id} label={`Match “${l.offeredName}” to a stock item`} hint={`${l.quantity} ${l.unit} offered`}>
            {(a) => (
              <select {...a} className="input" value={map[l.id] ?? ''} onChange={(e) => setMap({ ...map, [l.id]: e.target.value })}>
                <option value="">Choose…</option>
                {(catalogue.data?.data ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.unit})
                  </option>
                ))}
              </select>
            )}
          </Field>
        ))}
        <Field label="Instructions for the donor (optional)" hint="Gate, opening hours, contact on arrival">
          {(a) => <input {...a} className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button type="button" className="btn btn-primary" disabled={!locationId || unmapped.some((l) => !map[l.id]) || m.isPending} onClick={() => m.mutate()}>
            Accept offer
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function ReceiveDialog({ offer, onClose, onDone }) {
  const [qty, setQty] = useState(() => Object.fromEntries(offer.lines.map((l) => [l.id, l.quantity])));
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => suppliesApi.receive(offer.id, { lines: offer.lines.map((l) => ({ lineId: l.id, receivedQuantity: Number(qty[l.id] || 0) })), ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => (onDone('Counted into stock'), onClose()),
  });
  return (
    <Dialog title={`Count ${offer.referenceCode} into ${offer.receivingLocation?.name}`} onClose={onClose}>
      <div className="stack">
        <p className="small muted">Enter what actually arrived. Only these quantities are added to stock.</p>
        {offer.lines.map((l) => (
          <Field key={l.id} label={l.name} hint={`${l.quantity} ${l.unit} offered`}>
            {(a) => <input {...a} className="input" type="number" min="0" value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />}
          </Field>
        ))}
        <Field label="Note (optional)">{(a) => <input {...a} className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button type="button" className="btn btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>
            <PackageCheck size={16} /> Record receipt
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function OpsDonationsPage() {
  const { user, hasRole } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState('PENDING');
  const [dialog, setDialog] = useState(null);
  const q = useQuery({ queryKey: ['donations', 'ops', tab], queryFn: () => suppliesApi.list({ status: tab, pageSize: 50 }), refetchInterval: 45000 });
  const done = (msg) => {
    toast(msg);
    qc.invalidateQueries({ queryKey: ['donations'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
  };
  const canReceive = (o) => user.role === 'ADMIN' || (user.role === 'INVENTORY_MANAGER' && user.assignedLocations.some((l) => l.id === o.receivingLocation?.id));
  return (
    <div>
      <PageHead eyebrow="Operations" title="Donations">
        Offers of supplies from people, shops and organisations. Accept to tell the donor where to bring them; count them in when they arrive.
      </PageHead>
      <Tabs
        label="Donation status"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'PENDING', label: 'To review' },
          { value: 'ACCEPTED', label: 'Expected' },
          { value: 'RECEIVED', label: 'Received' },
          { value: 'REJECTED', label: 'Declined' },
        ]}
      />
      {q.isPending && <Loading rows={3} />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && q.data.data.length === 0 && <EmptyState title="Nothing here" />}
      <div className="stack">
        {q.data?.data.map((o) => (
          <article key={o.id} className="card">
            <div className="row-between">
              <span>
                <span className="code">{o.referenceCode}</span> <strong>{o.donorName}</strong>
              </span>
              <StatusBadge status={o.status} />
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              {o.deliveryMode === 'PICKUP' ? `Collect from: ${o.pickupAddress}` : 'Donor will drop off'}
              {o.availableFrom ? ` · from ${formatDateTime(o.availableFrom)}` : ''} · offered {timeAgo(o.createdAt)}
              {o.donor?.phone ? ` · ${o.donor.phone}` : o.donor?.email ? ` · ${o.donor.email}` : ''}
            </div>
            <ul className="small" style={{ margin: '8px 0' }}>
              {o.lines.map((l) => (
                <li key={l.id}>
                  {num(l.quantity)} {l.unit} — {l.name}
                  {!l.inventoryItemId && <span className="muted"> (not in catalogue)</span>}
                  {l.receivedQuantity != null && <span className="muted"> · received {num(l.receivedQuantity)}</span>}
                </li>
              ))}
            </ul>
            {o.notes && <p className="small">“{o.notes}”</p>}
            {o.receivingLocation && <div className="small">Receiving at {o.receivingLocation.name}</div>}
            <div className="row" style={{ marginTop: 10 }}>
              {o.status === 'PENDING' && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'accept', o })}>
                  Accept
                </button>
              )}
              {o.status === 'ACCEPTED' && canReceive(o) && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'receive', o })}>
                  <PackageCheck size={16} /> Count into stock
                </button>
              )}
              {o.status === 'ACCEPTED' && !canReceive(o) && hasRole('RELIEF_COORDINATOR') && <span className="small muted">The inventory manager of {o.receivingLocation?.name} records the receipt.</span>}
              {['PENDING', 'ACCEPTED'].includes(o.status) && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'reject', o })}>
                  Decline
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {dialog?.kind === 'accept' && <AcceptDialog offer={dialog.o} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'receive' && <ReceiveDialog offer={dialog.o} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'reject' && (
        <ReasonDialog
          title={`Decline ${dialog.o.referenceCode}`}
          description="The donor sees this reason."
          confirmLabel="Decline offer"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async (r) => (await suppliesApi.reject(dialog.o.id, r), done('Offer declined'))}
        />
      )}
    </div>
  );
}
