import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Baby, Check, Crosshair, Droplets, HeartPulse, House, MapPin, Package, Plus, Shirt, Soup, SprayCan, Tent, Trash2 } from 'lucide-react';
import { inventoryApi, placesApi, requestsApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useGeolocation } from '../../hooks/useGeolocation.js';
import { ErrorState, Field, Loading, Notice, PageHead } from '../../components/ui/index.jsx';
import { CATEGORIES, categoryLabel, LOCATION_TYPES } from '../../lib/format.js';
import { parseCoordinate } from '../../lib/geo.js';

const LeafletMap = lazy(() => import('../../components/map/LeafletMap.jsx'));

const CATEGORY_ICONS = { FOOD: Soup, WATER: Droplets, MEDICINE: HeartPulse, SHELTER: Tent, HYGIENE: SprayCan, CLOTHING: Shirt, OTHER: Package };
const STEPS = ['What you need', 'Items and people', 'Where', 'Review'];

function Steps({ current }) {
  return (
    <ol className="steps" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className={i < current ? 'done' : i === current ? 'current' : ''} aria-current={i === current ? 'step' : undefined}>
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  );
}

function ItemsStep({ category, items, setItems, people, setPeople, errors }) {
  const catalogue = useQuery({ queryKey: ['inventory', 'catalogue', category], queryFn: () => inventoryApi.catalogue({ category }) });
  const qty = (id) => items.find((i) => i.inventoryItemId === id)?.quantity ?? '';
  const setQty = (item, value) => {
    const n = value === '' ? '' : Math.max(0, Math.floor(Number(value)));
    setItems((prev) => {
      const rest = prev.filter((i) => i.inventoryItemId !== item.id);
      return n === '' || n === 0 ? rest : [...rest, { inventoryItemId: item.id, name: item.name, unit: item.unit, quantity: n }];
    });
  };
  const custom = items.filter((i) => !i.inventoryItemId);
  const updateCustom = (idx, patch) =>
    setItems((prev) => {
      const list = prev.filter((i) => !i.inventoryItemId);
      list[idx] = { ...list[idx], ...patch };
      return [...prev.filter((i) => i.inventoryItemId), ...list];
    });

  return (
    <div className="stack-lg">
      <div className="card stack">
        <h2 style={{ fontSize: '1.3rem' }}>Which {categoryLabel(category).toLowerCase()} items, and how many?</h2>
        {catalogue.isPending && <Loading rows={3} />}
        {catalogue.isError && <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />}
        {catalogue.data && catalogue.data.data.length === 0 && (
          <p className="muted">There are no standard items listed for this category. Describe what you need below.</p>
        )}
        {catalogue.data?.data.map((item) => (
          <div key={item.id} className="row-between" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
            <label htmlFor={`qty-${item.id}`} style={{ flex: '1 1 220px' }}>
              <strong>{item.name}</strong>
              <span className="small muted"> · counted in {item.unit}</span>
            </label>
            <input
              id={`qty-${item.id}`}
              className="input"
              style={{ width: 120 }}
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="0"
              value={qty(item.id)}
              onChange={(e) => setQty(item, e.target.value)}
            />
          </div>
        ))}
        <div className="stack">
          <span className="label">Something not listed?</span>
          {custom.map((c, idx) => (
            <div key={idx} className="row">
              <input className="input" style={{ flex: '2 1 180px' }} aria-label="Item name" placeholder="Item name" value={c.name} onChange={(e) => updateCustom(idx, { name: e.target.value })} />
              <input className="input" style={{ flex: '1 1 90px' }} aria-label="Unit" placeholder="Unit (e.g. packs)" value={c.unit} onChange={(e) => updateCustom(idx, { unit: e.target.value })} />
              <input
                className="input"
                style={{ flex: '0 1 110px' }}
                aria-label="Quantity"
                type="number"
                min="1"
                placeholder="Qty"
                value={c.quantity}
                onChange={(e) => updateCustom(idx, { quantity: e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))) })}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label="Remove item"
                onClick={() => setItems((prev) => [...prev.filter((i) => i.inventoryItemId), ...prev.filter((i) => !i.inventoryItemId).filter((_, j) => j !== idx)])}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setItems((p) => [...p, { name: '', unit: '', quantity: '' }])}>
            <Plus size={16} /> Add another item
          </button>
          <p className="hint">Items outside the standard list may take longer, because staff need to find a source for them.</p>
        </div>
        {errors.items && <span className="field-error">{errors.items}</span>}
      </div>

      <div className="card grid grid-2">
        <Field label="How many people is this for?" error={errors.peopleAffected}>
          {(a) => <input {...a} className="input" type="number" min="1" inputMode="numeric" value={people.peopleAffected} onChange={(e) => setPeople({ ...people, peopleAffected: e.target.value })} />}
        </Field>
        <Field
          label="Of them, how many are especially vulnerable? (optional)"
          hint="Young children, older people, pregnant women, people who are ill or disabled. This helps staff prioritise."
          error={errors.vulnerableCount}
        >
          {(a) => <input {...a} className="input" type="number" min="0" inputMode="numeric" value={people.vulnerableCount} onChange={(e) => setPeople({ ...people, vulnerableCount: e.target.value })} />}
        </Field>
      </div>
    </div>
  );
}

function PlaceStep({ place, setPlace, errors, user }) {
  const geo = useGeolocation();
  const camps = useQuery({ queryKey: ['locations', 'camps'], queryFn: () => placesApi.locations({ type: 'CAMP,SHELTER' }) });
  const allowedCamps = useMemo(() => {
    const all = camps.data ?? [];
    if (user.role === 'CAMP_MANAGER') return all.filter((c) => user.assignedLocations.some((l) => l.id === c.id));
    return all;
  }, [camps.data, user]);

  const useGps = () => geo.request();
  useEffect(() => {
    if (geo.status === 'ready' && geo.position) {
      const { latitude, longitude } = geo.position;
      setPlace((p) => (p.mode === 'gps' ? { ...p, latitude, longitude, latText: String(latitude), lngText: String(longitude) } : p));
    }
  }, [geo.status, geo.position, setPlace]);

  const modes = [
    { value: 'camp', label: 'I am at a relief camp or shelter', icon: House },
    { value: 'gps', label: 'Use my location', icon: Crosshair },
    { value: 'manual', label: 'Choose location manually', icon: MapPin },
  ];

  return (
    <div className="stack-lg">
      <div className="card stack">
        <h2 style={{ fontSize: '1.3rem' }}>Where should the supplies go?</h2>
        <div className="choice-grid" role="radiogroup" aria-label="How to give your location">
          {modes.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={place.mode === m.value}
              className="choice"
              onClick={() => {
                setPlace({ ...place, mode: m.value, ...(m.value !== 'camp' ? { campId: '' } : {}) });
                if (m.value !== 'gps') geo.reset();
              }}
            >
              <span className="choice-icon">
                <m.icon size={20} aria-hidden="true" />
              </span>
              <strong>{m.label}</strong>
            </button>
          ))}
        </div>

        {place.mode === 'camp' && (
          <Field label="Camp or shelter" error={errors.campId}>
            {(a) =>
              camps.isPending ? (
                <Loading rows={1} />
              ) : camps.isError ? (
                <ErrorState error={camps.error} onRetry={camps.refetch} />
              ) : allowedCamps.length === 0 ? (
                <p className="muted">No camps are listed{user.role === 'CAMP_MANAGER' ? ' for your account' : ''}. Choose your location another way.</p>
              ) : (
                <select {...a} className="input" value={place.campId} onChange={(e) => setPlace({ ...place, campId: e.target.value })}>
                  <option value="">Select a camp…</option>
                  {allowedCamps.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {LOCATION_TYPES[c.type]}
                      {c.area ? `, ${c.area}` : ''}
                    </option>
                  ))}
                </select>
              )
            }
          </Field>
        )}

        {place.mode === 'gps' && (
          <div className="stack">
            <Notice title="Why we ask for your location">
              Your position helps relief staff send supplies to the right place and find the nearest stock. It is shared only with staff handling your request. Your browser will ask for permission — you can say no and choose manually instead.
            </Notice>
            <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={useGps} disabled={geo.status === 'locating'}>
              <Crosshair size={18} /> {geo.status === 'locating' ? 'Finding your location…' : geo.status === 'ready' ? 'Update my location' : 'Share my location now'}
            </button>
            {geo.status === 'ready' && (
              <p className="small">
                Location found (accuracy about {geo.position.accuracyMeters} m): <span className="code">{geo.position.latitude}, {geo.position.longitude}</span>
              </p>
            )}
            {geo.status === 'ready' && geo.position.accuracyMeters > 100 && (
              <Notice tone="warn" title="This location is not very precise">
                Your device could only place you within about {geo.position.accuracyMeters} m. Add an address or landmark below, or{' '}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlace({ ...place, mode: 'manual' })}>
                  drop a pin on the map
                </button>
              </Notice>
            )}
            {geo.error && (
              <Notice tone="warn" title="Location not shared">
                {geo.error}{' '}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlace({ ...place, mode: 'manual' })}>
                  Choose manually
                </button>
              </Notice>
            )}
          </div>
        )}

        {place.mode === 'manual' && (
          <div className="stack">
            <p className="small muted">Tap the map to drop a pin, or type coordinates if you know them. You can also just give an address below.</p>
            <Suspense fallback={<Loading label="Loading map…" />}>
              <LeafletMap
                label="Pick a delivery point"
                you={place.latitude != null ? { latitude: place.latitude, longitude: place.longitude } : null}
                onPick={(p) => setPlace({ ...place, ...p, latText: String(p.latitude), lngText: String(p.longitude) })}
                fallbackCenter={[30.32, 78.03]}
                fallbackZoom={10}
              />
            </Suspense>
            <div className="grid grid-2">
              <Field label="Latitude (optional)" error={errors.latitude}>
                {(a) => (
                  <input
                    {...a}
                    className="input"
                    inputMode="decimal"
                    value={place.latText ?? ''}
                    onChange={(e) => {
                      const lat = parseCoordinate(e.target.value, 'lat');
                      setPlace({ ...place, latText: e.target.value, latitude: lat });
                    }}
                  />
                )}
              </Field>
              <Field label="Longitude (optional)">
                {(a) => (
                  <input
                    {...a}
                    className="input"
                    inputMode="decimal"
                    value={place.lngText ?? ''}
                    onChange={(e) => {
                      const lng = parseCoordinate(e.target.value, 'lng');
                      setPlace({ ...place, lngText: e.target.value, longitude: lng });
                    }}
                  />
                )}
              </Field>
            </div>
          </div>
        )}

        <Field label="Address or landmark" hint="Street, building, nearby landmark — anything that helps a driver find you." error={errors.destinationAddress}>
          {(a) => <input {...a} className="input" maxLength={300} value={place.destinationAddress} onChange={(e) => setPlace({ ...place, destinationAddress: e.target.value })} />}
        </Field>
      </div>
    </div>
  );
}

export default function RequestWizard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState(null);
  const [items, setItems] = useState([]);
  const [people, setPeople] = useState({ peopleAffected: '', vulnerableCount: '' });
  const [description, setDescription] = useState('');
  const [place, setPlace] = useState({ mode: user.role === 'CAMP_MANAGER' ? 'camp' : 'gps', campId: user.assignedLocations?.[0]?.id ?? '', latitude: null, longitude: null, destinationAddress: '' });
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState({});

  const camps = useQuery({ queryKey: ['locations', 'camps'], queryFn: () => placesApi.locations({ type: 'CAMP,SHELTER' }) });
  const submit = useMutation({
    mutationFn: requestsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
    onError: (err) => setErrors((e) => ({ ...e, ...err.fieldErrors?.() })),
  });

  const cleanItems = items.filter((i) => i.quantity > 0 && (i.inventoryItemId || (i.name?.trim() && i.unit?.trim())));

  const validate = (s) => {
    const e = {};
    if (s === 0 && !category) e.category = 'Choose what you need.';
    if (s === 1) {
      if (!cleanItems.length) e.items = 'Add at least one item with a quantity.';
      if (items.some((i) => !i.inventoryItemId && (i.name || i.unit || i.quantity) && !(i.name?.trim() && i.unit?.trim() && i.quantity > 0))) e.items = 'Complete or remove the extra items (name, unit and quantity).';
      const p = Number(people.peopleAffected);
      if (!Number.isInteger(p) || p < 1) e.peopleAffected = 'Enter the number of people (at least 1).';
      if (people.vulnerableCount !== '') {
        const v = Number(people.vulnerableCount);
        if (!Number.isInteger(v) || v < 0) e.vulnerableCount = 'Enter a whole number, or leave it empty.';
        else if (v > p) e.vulnerableCount = 'This cannot be more than the number of people.';
      }
    }
    if (s === 2) {
      if (place.mode === 'camp' && !place.campId) e.campId = 'Select your camp, or choose another option.';
      const hasCoords = place.latitude != null && place.longitude != null;
      if ((place.latText || place.lngText) && !hasCoords && place.mode === 'manual') e.latitude = 'These coordinates are not valid. Clear them or fix them.';
      if (place.mode !== 'camp' && !hasCoords && !place.destinationAddress.trim()) e.destinationAddress = 'Give an address or landmark, or share/pick a location.';
    }
    if (s === 3) {
      if (description.trim().length < 5) e.description = 'Please describe the situation in a few words.';
      if (!agree) e.agree = 'Please confirm before sending.';
    }
    return e;
  };

  const next = () => {
    const e = validate(step);
    setErrors(e);
    if (!Object.keys(e).length) setStep((s) => s + 1);
  };

  const send = () => {
    const e = validate(3);
    setErrors(e);
    if (Object.keys(e).length || submit.isPending) return;
    const hasCoords = place.mode !== 'camp' && place.latitude != null && place.longitude != null;
    submit.mutate({
      category,
      description: description.trim(),
      peopleAffected: Number(people.peopleAffected),
      ...(people.vulnerableCount !== '' ? { vulnerableCount: Number(people.vulnerableCount) } : {}),
      items: cleanItems.map((i) => (i.inventoryItemId ? { inventoryItemId: i.inventoryItemId, quantity: i.quantity } : { name: i.name.trim(), unit: i.unit.trim(), quantity: i.quantity })),
      ...(place.mode === 'camp' && place.campId ? { campId: place.campId } : {}),
      ...(place.destinationAddress.trim() ? { destinationAddress: place.destinationAddress.trim() } : {}),
      ...(hasCoords ? { latitude: place.latitude, longitude: place.longitude } : {}),
    });
  };

  // Success is shown only after the backend confirms and returns the real reference code.
  if (submit.isSuccess) {
    const r = submit.data;
    return (
      <div className="container" style={{ maxWidth: 720 }}>
        <div className="section-tight">
          <div className="card stack" role="status">
            <div className="row">
              <span className="choice-icon" style={{ background: 'var(--pale)', borderRadius: 12, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Check color="var(--orange-deep)" />
              </span>
              <h1 style={{ fontSize: '1.8rem', margin: 0 }}>Request received</h1>
            </div>
            <p>Your request reference is</p>
            <div className="ref-code">{r.referenceCode}</div>
            <p className="muted">Keep this reference. Relief staff will check your request next — you will get a notification when it is verified, and at each delivery step.</p>
            <Notice>Being received does not yet mean supplies are on the way. The tracking page always shows the real state.</Notice>
            <div className="row">
              <Link to={`/requests/${r.id}`} className="btn btn-primary">
                Track this request
              </Link>
              <Link to="/help" className="btn btn-secondary">
                Find nearby help meanwhile
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const campName = camps.data?.find((c) => c.id === place.campId)?.name;

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <PageHead eyebrow="Request essential supplies" title="What do you need?">
        Tell us what is needed and where. Relief staff check every request before supplies are sent.
      </PageHead>
      <Steps current={step} />

      {step === 0 && (
        <div className="card stack">
          <div className="choice-grid" role="radiogroup" aria-label="Supply category">
            {CATEGORIES.map((c) => {
              const Icon = CATEGORY_ICONS[c.value];
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={category === c.value}
                  className="choice"
                  onClick={() => {
                    if (category !== c.value) setItems([]);
                    setCategory(c.value);
                  }}
                >
                  <span className="choice-icon">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <strong>{c.label}</strong>
                </button>
              );
            })}
          </div>
          {errors.category && <span className="field-error">{errors.category}</span>}
          <p className="small muted" style={{ margin: 0 }}>
            <Baby size={14} aria-hidden="true" /> Need several kinds of supplies? Send one request per kind so each can be sourced quickly.
          </p>
        </div>
      )}

      {step === 1 && <ItemsStep category={category} items={items} setItems={setItems} people={people} setPeople={setPeople} errors={errors} />}
      {step === 2 && <PlaceStep place={place} setPlace={setPlace} errors={errors} user={user} />}

      {step === 3 && (
        <div className="stack-lg">
          <div className="card stack">
            <Field label="Describe the situation" hint="What happened, who needs help, anything a delivery team should know." error={errors.description}>
              {(a) => <textarea {...a} className="input" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />}
            </Field>
          </div>
          <div className="card">
            <h2 style={{ fontSize: '1.3rem' }}>Check your request</h2>
            <dl className="kv">
              <dt>Need</dt>
              <dd>{categoryLabel(category)}</dd>
              <dt>Items</dt>
              <dd>
                {cleanItems.map((i) => (
                  <div key={i.inventoryItemId ?? i.name}>
                    {i.quantity} {i.unit} — {i.name}
                  </div>
                ))}
              </dd>
              <dt>People</dt>
              <dd>
                {people.peopleAffected}
                {people.vulnerableCount !== '' ? ` (${people.vulnerableCount} especially vulnerable)` : ''}
              </dd>
              <dt>Deliver to</dt>
              <dd>
                {place.mode === 'camp' && campName ? campName : null}
                {place.mode !== 'camp' && place.latitude != null ? `Pinned location (${place.latitude}, ${place.longitude})` : null}
                {place.destinationAddress ? <div>{place.destinationAddress}</div> : null}
              </dd>
            </dl>
          </div>
          <Notice title="Privacy">
            Your name, contact details and exact location are visible only to relief staff working on your request. Priority is set by relief staff using published rules, not by the requester.
          </Notice>
          <label className="checkbox">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>I confirm this information is true to the best of my knowledge, and I understand DisplaceOS is not an emergency rescue service.</span>
          </label>
          {errors.agree && <span className="field-error">{errors.agree}</span>}
          {submit.isError && (
            <Notice tone="danger" title="Your request was not sent">
              {submit.error.message}
              {submit.error.details?.length > 0 && (
                <ul className="small">
                  {submit.error.details.map((d, i) => (
                    <li key={i}>{d.message ?? JSON.stringify(d)}</li>
                  ))}
                </ul>
              )}
              <div className="small">Nothing was saved. Please check and try again.</div>
            </Notice>
          )}
        </div>
      )}

      <div className="row-between" style={{ marginTop: 24 }}>
        <button type="button" className="btn btn-ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || submit.isPending}>
          Back
        </button>
        {step < 3 ? (
          <button type="button" className="btn btn-primary btn-lg" onClick={next}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-lg" onClick={send} disabled={submit.isPending}>
            {submit.isPending ? 'Sending…' : 'Send request'}
          </button>
        )}
      </div>
    </div>
  );
}
