import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Crosshair, LifeBuoy, MapPin, PhoneCall, Siren, X } from 'lucide-react';
import { sosApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/Toast.jsx';
import { useGeolocation } from '../../hooks/useGeolocation.js';
import { Badge, Dialog, EmptyState, ErrorState, Field, Loading, Notice, PageHead, ReasonDialog } from '../../components/ui/index.jsx';
import { formatDateTime, timeAgo } from '../../lib/format.js';
import { Timeline } from '../tracking/TrackingParts.jsx';

const LeafletMap = lazy(() => import('../../components/map/LeafletMap.jsx'));

const RESPONDER_ROLES = ['RESPONSE_TEAM', 'RELIEF_COORDINATOR', 'ADMIN', 'CAMP_MANAGER'];
const STATUS = {
  ACTIVE: 'Waiting for a responder',
  RESPONDING: 'Help is on the way',
  RESOLVED: 'Closed',
  CANCELLED: 'Cancelled — person is safe',
};
const OUTCOME = { RESCUED: 'Rescued', NOT_FOUND: 'Not found at the location', FALSE_ALARM: 'False alarm' };

const mapsLink = (s) => `https://www.openstreetmap.org/?mlat=${s.latitude}&mlon=${s.longitude}#map=17/${s.latitude}/${s.longitude}`;

function readDismissed() {
  try {
    return JSON.parse(sessionStorage.getItem('dos-sos-dismissed') ?? '{}');
  } catch {
    return {};
  }
}
function writeDismissed(v) {
  try {
    sessionStorage.setItem('dos-sos-dismissed', JSON.stringify(v));
  } catch {
    // Dismissal memory is optional.
  }
}

export function useActiveSos() {
  return useQuery({ queryKey: ['sos', 'active'], queryFn: () => sosApi.active(), refetchInterval: 15000 });
}

// Full-screen red pop-up for every visitor on every page, plus a persistent strip while any SOS is open.
export function SosAlertLayer() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const q = useActiveSos();
  const [dismissed, setDismissed] = useState(readDismissed);
  const vibrated = useRef(new Set());
  const responder = Boolean(user && RESPONDER_ROLES.includes(user.role));
  const open = (q.data?.data ?? []).filter((s) => !s.isOwn);
  // Responders keep being interrupted while nobody has taken the SOS; everyone else sees each SOS once.
  const popup = open.find((s) => (responder ? s.status === 'ACTIVE' && dismissed[s.id] !== 'ACTIVE' : !dismissed[s.id]));
  const respond = useMutation({
    mutationFn: sosApi.respond,
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['sos'] });
      toast(`You are responding to ${s.referenceCode}`);
      navigate('/ops/sos');
    },
  });

  useEffect(() => {
    if (popup && !vibrated.current.has(popup.id)) {
      vibrated.current.add(popup.id);
      navigator.vibrate?.([400, 150, 400, 150, 400]);
    }
  }, [popup]);

  const dismiss = (s) => {
    const next = { ...dismissed, [s.id]: s.status };
    setDismissed(next);
    writeDismissed(next);
  };

  return (
    <>
      {open.length > 0 && (
        <div className="sos-strip" role="status">
          <div className="container row-between">
            <span className="row" style={{ flexWrap: 'nowrap' }}>
              <Siren size={18} aria-hidden="true" />
              <strong>
                {open.length === 1 ? 'Emergency' : `${open.length} emergencies`}: {open.map((s) => `${s.areaLabel} — ${STATUS[s.status].toLowerCase()}`).join(' · ')}
              </strong>
            </span>
            {responder ? (
              <Link to="/ops/sos" className="btn btn-sm sos-strip-btn">
                Open SOS board
              </Link>
            ) : (
              <a href="tel:112" className="btn btn-sm sos-strip-btn">
                <PhoneCall size={14} /> 112
              </a>
            )}
          </div>
        </div>
      )}
      {popup && (
        <div className="sos-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="sos-title">
          <div className="sos-modal">
            <div className="sos-modal-head">
              <Siren size={34} aria-hidden="true" className="sos-pulse" />
              <div>
                <div className="sos-kicker">Emergency rescue request · {popup.referenceCode}</div>
                <h2 id="sos-title">
                  {popup.peopleCount > 1 ? `${popup.peopleCount} people need` : 'Someone needs'} rescue {popup.areaLabel}
                </h2>
              </div>
            </div>
            <p className="sos-meta">
              Sent {timeAgo(popup.createdAt)} · {STATUS[popup.status]}
              {popup.respondingTeam ? ` (${popup.respondingTeam})` : ''}
            </p>
            {responder ? (
              <>
                {popup.message && <blockquote className="sos-message">“{popup.message}”</blockquote>}
                {popup.requester && (
                  <p className="small">
                    From {popup.requester.fullName}
                    {popup.requester.phone ? (
                      <>
                        {' '}
                        · <a href={`tel:${popup.requester.phone.replace(/\s/g, '')}`}>{popup.requester.phone}</a>
                      </>
                    ) : (
                      ' · no phone on record'
                    )}
                    {popup.address ? ` · ${popup.address}` : ''}
                  </p>
                )}
                {popup.latitude != null && (
                  <Suspense fallback={<Loading />}>
                    <LeafletMap
                      label="SOS location"
                      markers={[{ id: popup.id, latitude: popup.latitude, longitude: popup.longitude, kind: 'request', title: popup.referenceCode }]}
                      circles={popup.accuracyMeters ? [{ id: 'acc', latitude: popup.latitude, longitude: popup.longitude, radiusKm: popup.accuracyMeters / 1000, pathOptions: { color: '#8f2c0b', weight: 1, fillColor: '#dd6f25', fillOpacity: 0.2 } }] : []}
                    />
                  </Suspense>
                )}
                {respond.isError && <Notice tone="danger">{respond.error.message}</Notice>}
                <div className="row" style={{ marginTop: 14 }}>
                  {popup.status === 'ACTIVE' && (
                    <button type="button" className="btn btn-lg sos-btn" disabled={respond.isPending} onClick={() => respond.mutate(popup.id)}>
                      <LifeBuoy size={18} /> I'm responding
                    </button>
                  )}
                  {popup.latitude != null && (
                    <a className="btn btn-secondary" href={mapsLink(popup)} target="_blank" rel="noreferrer">
                      <MapPin size={16} /> Open in maps
                    </a>
                  )}
                  <button type="button" className="btn btn-ghost" onClick={() => dismiss(popup)}>
                    <X size={16} /> Not me — dismiss
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  Relief responders have been alerted. If you are nearby and it is safe, call emergency services on <strong>112</strong> and tell them the area. Do not put yourself in danger.
                </p>
                <div className="row" style={{ marginTop: 14 }}>
                  <a className="btn btn-lg sos-btn" href="tel:112">
                    <PhoneCall size={18} /> Call 112
                  </a>
                  <button type="button" className="btn btn-secondary" onClick={() => dismiss(popup)}>
                    I understand
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function SosPage() {
  const { user, status } = useAuth();
  const navigate = useNavigate();
  const geo = useGeolocation();
  const [message, setMessage] = useState('');
  const [peopleCount, setPeopleCount] = useState('1');
  const [address, setAddress] = useState('');
  const [error, setError] = useState(null);
  const mine = useQuery({ queryKey: ['sos', 'mine'], queryFn: sosApi.mine, enabled: status === 'authenticated' });
  const openOwn = mine.data?.find((s) => ['ACTIVE', 'RESPONDING'].includes(s.status));
  const send = useMutation({
    mutationFn: sosApi.raise,
    onSuccess: (s) => navigate(`/sos/${s.id}`, { replace: true }),
    onError: (err) => setError(err),
  });

  // Ask for the position as soon as the page opens; the browser shows its own permission prompt.
  useEffect(() => {
    if (status === 'authenticated' && geo.status === 'idle') geo.request();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'loading') return <Loading />;
  if (openOwn) return <SosStatusView id={openOwn.id} />;

  const submit = (e) => {
    e.preventDefault();
    setError(null);
    if (message.trim().length < 3) return setError({ message: 'Say in a few words what is happening.' });
    if (!geo.position && address.trim().length < 3) return setError({ message: 'Share your location, or type where you are.' });
    send.mutate({
      message: message.trim(),
      peopleCount: Math.max(1, Number(peopleCount) || 1),
      ...(geo.position ? { latitude: geo.position.latitude, longitude: geo.position.longitude, accuracyMeters: geo.position.accuracyMeters } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
    });
  };

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <div className="sos-call-first">
        <PhoneCall size={22} aria-hidden="true" />
        <div>
          <strong>In immediate danger? Call 112 first.</strong>
          <div className="small">DisplaceOS alerts relief responders, but it is not a replacement for emergency services.</div>
        </div>
        <a href="tel:112" className="btn sos-btn">
          Call 112
        </a>
      </div>
      <PageHead eyebrow="Emergency" title="I need rescue now">
        Your SOS pops up on the screen of every responder and relief worker using DisplaceOS. Only they see your exact location and message.
      </PageHead>
      {status !== 'authenticated' ? (
        <div className="card stack">
          <p>To stop false alarms, an SOS is sent from an account. It takes one minute to create one.</p>
          <div className="row">
            <Link to="/login" state={{ from: '/sos' }} className="btn btn-primary">
              Sign in
            </Link>
            <Link to="/register" state={{ from: '/sos' }} className="btn btn-secondary">
              Create account
            </Link>
          </div>
        </div>
      ) : (
        <form className="card stack" onSubmit={submit}>
          <div className="stack">
            <span className="label">Your location</span>
            {geo.status === 'locating' && <span className="small">Finding your location…</span>}
            {geo.status === 'ready' && (
              <Notice icon={MapPin} title="Location found">
                Accurate to about {geo.position.accuracyMeters} m. {geo.position.accuracyMeters > 100 ? 'This is not very precise — also describe where you are below.' : ''}
              </Notice>
            )}
            {(geo.status === 'denied' || geo.status === 'error' || geo.status === 'unsupported') && (
              <Notice tone="warn" title="Location not shared">
                Type where you are below — a landmark, street or building.{' '}
                <button type="button" className="btn btn-ghost btn-sm" onClick={geo.request}>
                  <Crosshair size={14} /> Try again
                </button>
              </Notice>
            )}
          </div>
          <Field label="Where are you? (landmark, street, building)" hint={geo.position ? 'Optional, but helps responders find you' : 'Required when location is not shared'}>
            {(a) => <input {...a} className="input" maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} />}
          </Field>
          <Field label="What is happening?" hint="For example: trapped on roof, water rising, injured person">
            {(a) => <textarea {...a} className="input" style={{ minHeight: 90 }} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />}
          </Field>
          <Field label="How many people need rescue?">
            {(a) => <input {...a} className="input" style={{ width: 120 }} type="number" min="1" value={peopleCount} onChange={(e) => setPeopleCount(e.target.value)} />}
          </Field>
          {error && <Notice tone="danger">{error.message}</Notice>}
          <button className="btn btn-lg sos-btn" disabled={send.isPending}>
            <Siren size={20} /> {send.isPending ? 'Sending SOS…' : 'Send SOS'}
          </button>
          <p className="small muted" style={{ margin: 0 }}>
            Signed in as {user.fullName}. Your name and phone number are shared with responders so they can reach you.
          </p>
        </form>
      )}
    </div>
  );
}

function SosStatusView({ id }) {
  const toast = useToast();
  const geo = useGeolocation();
  const qc = useQueryClient();
  const [safe, setSafe] = useState(false);
  const q = useQuery({ queryKey: ['sos', id], queryFn: () => sosApi.get(id), refetchInterval: 10000 });
  const move = useMutation({ mutationFn: (p) => sosApi.updateLocation(id, p), onSuccess: () => (toast('Location updated'), qc.invalidateQueries({ queryKey: ['sos'] })) });
  useEffect(() => {
    if (geo.status === 'ready') move.mutate(geo.position);
  }, [geo.status, geo.position]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isPending) return <Loading />;
  if (q.isError) return <div className="container section"><ErrorState error={q.error} onRetry={q.refetch} /></div>;
  const s = q.data;
  const open = ['ACTIVE', 'RESPONDING'].includes(s.status);
  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <header className="page-head">
        <div className="eyebrow">Your SOS</div>
        <h1 className="ref-code" style={{ fontSize: '2rem' }}>
          {s.referenceCode}
        </h1>
        <Badge className={s.status === 'RESPONDING' ? 'avail-AVAILABLE' : s.status === 'ACTIVE' ? 'sev-HYPER_RED' : ''}>{STATUS[s.status]}</Badge>
      </header>
      {s.status === 'ACTIVE' && (
        <Notice tone="danger" icon={Siren} title="Your SOS is showing on every responder's screen">
          Stay where you are if it is safe, and keep your phone on. If you are in immediate danger, also <a href="tel:112">call 112</a>.
        </Notice>
      )}
      {s.status === 'RESPONDING' && (
        <Notice icon={LifeBuoy} title={`${s.respondingTeam ?? 'A responder'} is coming`}>
          {s.responder?.fullName} responded {timeAgo(s.respondedAt)}.{' '}
          {s.responder?.phone && (
            <>
              You can call them on <a href={`tel:${s.responder.phone.replace(/\s/g, '')}`}>{s.responder.phone}</a>.
            </>
          )}
        </Notice>
      )}
      {s.status === 'RESOLVED' && (
        <Notice icon={CheckCircle2} title={OUTCOME[s.outcome]}>
          {s.resolutionNote}
          {s.locationCheck === 'VERIFIED' && ' · The responder was at your location.'}
        </Notice>
      )}
      <div className="grid grid-2" style={{ marginTop: 16, alignItems: 'start' }}>
        <div className="card stack">
          <dl className="kv">
            <dt>Area</dt>
            <dd>{s.areaLabel}</dd>
            <dt>People</dt>
            <dd>{s.peopleCount}</dd>
            <dt>Message</dt>
            <dd>{s.message}</dd>
            <dt>Sent</dt>
            <dd>{formatDateTime(s.createdAt)}</dd>
          </dl>
          {open && (
            <div className="row">
              <button type="button" className="btn btn-secondary btn-sm" onClick={geo.request} disabled={geo.status === 'locating' || move.isPending}>
                <Crosshair size={14} /> I've moved — update my location
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setSafe(true)}>
                <CheckCircle2 size={14} /> I'm safe now
              </button>
              <a href="tel:112" className="btn btn-sm sos-btn">
                <PhoneCall size={14} /> 112
              </a>
            </div>
          )}
        </div>
        <div className="card">
          <h2 style={{ fontSize: '1.15rem' }}>Updates</h2>
          <Timeline events={(s.events ?? []).map((e, i) => ({ id: i, message: e.message, createdAt: e.createdAt }))} />
        </div>
      </div>
      {s.latitude != null && (
        <div style={{ marginTop: 16 }}>
          <Suspense fallback={<Loading />}>
            <LeafletMap label="Your SOS location" you={{ latitude: s.latitude, longitude: s.longitude }} />
          </Suspense>
        </div>
      )}
      {safe && (
        <ReasonDialog
          title="Tell responders you are safe"
          description="This closes your SOS and tells anyone on the way."
          confirmLabel="Close my SOS"
          onClose={() => setSafe(false)}
          onConfirm={async (r) => (await sosApi.cancel(s.id, r), qc.invalidateQueries({ queryKey: ['sos'] }), toast('SOS closed'))}
        />
      )}
    </div>
  );
}

export function SosStatusPage() {
  const { sosId } = useParams();
  return <SosStatusView id={sosId} />;
}

function ResolveDialog({ sos, onClose, onDone }) {
  const geo = useGeolocation();
  const [outcome, setOutcome] = useState('RESCUED');
  const [note, setNote] = useState('');
  useEffect(() => {
    geo.request();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const distance = useMemo(() => {
    if (!geo.position || sos.latitude == null) return null;
    const rad = (d) => (d * Math.PI) / 180;
    const a = geo.position;
    const h = Math.sin(rad(sos.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(sos.latitude)) * Math.sin(rad(sos.longitude - a.longitude) / 2) ** 2;
    return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
  }, [geo.position, sos]);
  const m = useMutation({
    mutationFn: () => sosApi.resolve(sos.id, { outcome, note: note.trim(), ...(geo.position ? { latitude: geo.position.latitude, longitude: geo.position.longitude, accuracyMeters: geo.position.accuracyMeters } : {}) }),
    onSuccess: () => (onDone(), onClose()),
  });
  return (
    <Dialog title={`Close ${sos.referenceCode}`} onClose={onClose}>
      <div className="stack">
        <div className="row" role="radiogroup" aria-label="Outcome">
          {Object.entries(OUTCOME).map(([k, v]) => (
            <button key={k} type="button" role="radio" aria-checked={outcome === k} className={`btn btn-sm ${outcome === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOutcome(k)}>
              {v}
            </button>
          ))}
        </div>
        {geo.status === 'locating' && <span className="small">Checking your location…</span>}
        {distance != null && (
          <Notice tone={distance <= 300 + Math.min(geo.position.accuracyMeters ?? 0, 500) ? 'info' : 'warn'} icon={MapPin}>
            You are about {distance} m from the SOS location{distance <= 300 + Math.min(geo.position.accuracyMeters ?? 0, 500) ? ' — this will be recorded as location verified.' : ' — it will be recorded as not at the location.'}
          </Notice>
        )}
        {geo.error && <Notice tone="warn">Your location could not be read; the closure will be recorded without location verification.</Notice>}
        <Field label="What happened?" hint="Where the person was taken, their condition, or why it was closed">
          {(a) => <textarea {...a} className="input" style={{ minHeight: 80 }} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button type="button" className="btn btn-primary" disabled={note.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            Close SOS
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function SosBoardPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useActiveSos();
  const [resolving, setResolving] = useState(null);
  const respond = useMutation({ mutationFn: sosApi.respond, onSuccess: () => (qc.invalidateQueries({ queryKey: ['sos'] }), toast('You are responding')) });
  const list = q.data?.data ?? [];
  const coordinator = ['RELIEF_COORDINATOR', 'ADMIN'].includes(user.role);
  return (
    <div>
      <PageHead eyebrow="Operations" title="SOS board">
        Open rescue calls, newest first. Take one with “I'm responding”, then close it from the location once the person is safe.
      </PageHead>
      {q.isPending && <Loading rows={2} />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && list.length === 0 && <EmptyState icon={LifeBuoy} title="No open SOS calls">New calls pop up on your screen immediately.</EmptyState>}
      {list.some((s) => s.latitude != null) && (
        <Suspense fallback={<Loading />}>
          <LeafletMap
            label="Open SOS calls"
            markers={list.filter((s) => s.latitude != null).map((s) => ({ id: s.id, latitude: s.latitude, longitude: s.longitude, kind: 'request', title: s.referenceCode, popup: <span>{s.referenceCode}: {s.message}</span> }))}
          />
        </Suspense>
      )}
      <div className="stack" style={{ marginTop: 16 }}>
        {list.map((s) => {
          const mine = s.responder?.id === user.id;
          return (
            <article key={s.id} className={`card ${s.status === 'ACTIVE' ? 'sos-card-active' : ''}`}>
              <div className="row-between">
                <div className="row">
                  <Siren size={18} color="#8f2c0b" aria-hidden="true" />
                  <span className="code">{s.referenceCode}</span>
                  <Badge className={s.status === 'ACTIVE' ? 'sev-HYPER_RED' : 'avail-AVAILABLE'}>{STATUS[s.status]}</Badge>
                </div>
                <span className="small muted">{timeAgo(s.createdAt)}</span>
              </div>
              <p style={{ margin: '8px 0' }}>
                <strong>“{s.message}”</strong>
              </p>
              <div className="small">
                {s.peopleCount} {s.peopleCount === 1 ? 'person' : 'people'} · {s.areaLabel}
                {s.address ? ` · ${s.address}` : ''}
                {s.requester ? ` · ${s.requester.fullName}` : ''}
                {s.requester?.phone && (
                  <>
                    {' '}
                    · <a href={`tel:${s.requester.phone.replace(/\s/g, '')}`}>{s.requester.phone}</a>
                  </>
                )}
                {s.accuracyMeters ? ` · location accurate to about ${Math.round(s.accuracyMeters)} m` : ''}
              </div>
              {s.status === 'RESPONDING' && <div className="small" style={{ marginTop: 4 }}>Taken by {s.responder?.fullName}{s.respondingTeam ? ` (${s.respondingTeam})` : ''} {timeAgo(s.respondedAt)}</div>}
              <div className="row" style={{ marginTop: 10 }}>
                {s.status === 'ACTIVE' && (
                  <button type="button" className="btn btn-sm sos-btn" disabled={respond.isPending} onClick={() => respond.mutate(s.id)}>
                    <LifeBuoy size={14} /> I'm responding
                  </button>
                )}
                {s.latitude != null && (
                  <a className="btn btn-secondary btn-sm" href={mapsLink(s)} target="_blank" rel="noreferrer">
                    <MapPin size={14} /> Open in maps
                  </a>
                )}
                {(mine || coordinator) && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setResolving(s)}>
                    <CheckCircle2 size={14} /> Close SOS
                  </button>
                )}
              </div>
              {respond.isError && respond.variables === s.id && <Notice tone="danger">{respond.error.message}</Notice>}
            </article>
          );
        })}
      </div>
      {resolving && <ResolveDialog sos={resolving} onClose={() => setResolving(null)} onDone={() => (qc.invalidateQueries({ queryKey: ['sos'] }), toast('SOS closed'))} />}
    </div>
  );
}
