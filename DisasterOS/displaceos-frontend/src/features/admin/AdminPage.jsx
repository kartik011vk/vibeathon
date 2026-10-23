import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { auditApi, placesApi, rulesApi, usersApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/Toast.jsx';
import { Badge, Dialog, EmptyState, ErrorState, Field, Loading, Notice, PageHead, SeverityBadge, Tabs } from '../../components/ui/index.jsx';
import { CATEGORIES, formatDateTime, HAZARD_LABELS, LOCATION_TYPES, ROLE_LABELS, SEVERITIES, SEVERITY } from '../../lib/format.js';
import { parseCoordinate } from '../../lib/geo.js';

const ROLES = Object.keys(ROLE_LABELS);

function RoleDialog({ target, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const locations = useQuery({ queryKey: ['locations', 'all'], queryFn: () => placesApi.locations() });
  const [role, setRole] = useState(target.role);
  const [locationIds, setLocationIds] = useState(target.assignedLocations.map((l) => l.id));
  const [isActive, setIsActive] = useState(target.isActive);
  const [reason, setReason] = useState('');
  const scoped = role === 'CAMP_MANAGER' || role === 'INVENTORY_MANAGER';
  const m = useMutation({
    mutationFn: () => usersApi.changeRole(target.id, { role, isActive, reason: reason.trim(), locationIds: scoped ? locationIds : [] }),
    onSuccess: () => (toast('Access updated — the user must sign in again'), qc.invalidateQueries({ queryKey: ['users'] }), onClose()),
  });
  const pool = (locations.data ?? []).filter((l) => (role === 'CAMP_MANAGER' ? ['CAMP', 'SHELTER'].includes(l.type) : l.type !== 'OTHER'));
  return (
    <Dialog title={`Access for ${target.fullName}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
        <Field label="Role">
          {(a) => (
            <select {...a} className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {scoped && (
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">{role === 'CAMP_MANAGER' ? 'Camps managed' : 'Stock locations managed'}</legend>
            {pool.map((l) => (
              <label key={l.id} className="checkbox">
                <input type="checkbox" checked={locationIds.includes(l.id)} onChange={(e) => setLocationIds((ids) => (e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id)))} />
                <span>
                  {l.name} <span className="small muted">· {LOCATION_TYPES[l.type]}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span>Account active</span>
        </label>
        <Field label="Reason (recorded in the audit log)">{(a) => <input {...a} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button className="btn btn-primary" disabled={m.isPending || reason.trim().length < 3}>
            Save access
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Users() {
  const { user } = useAuth();
  const [role, setRole] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const q = useQuery({ queryKey: ['users', role, search], queryFn: () => usersApi.list({ role: role || undefined, search: search || undefined, pageSize: 100 }), placeholderData: (p) => p });
  return (
    <div className="stack">
      <div className="row">
        <select className="input" style={{ width: 'auto' }} aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <input className="input" style={{ width: 260 }} aria-label="Search users" placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {q.isPending && <Loading rows={4} />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Scope</th>
                <th scope="col">Status</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.fullName}
                    <div className="small muted">{u.email}</div>
                  </td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td className="small">{[...u.assignedLocations.map((l) => l.name), ...u.teams.map((t) => t.name)].join(', ') || '—'}</td>
                  <td>{u.isActive ? <Badge>Active</Badge> : <Badge outline>Deactivated</Badge>}</td>
                  <td>
                    {u.id !== user.id && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(u)}>
                        Change access
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <RoleDialog target={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Places() {
  const qc = useQueryClient();
  const toast = useToast();
  const locations = useQuery({ queryKey: ['locations', 'all'], queryFn: () => placesApi.locations() });
  const zones = useQuery({ queryKey: ['zones', 'all'], queryFn: () => placesApi.zones() });
  const [dialog, setDialog] = useState(null);
  const [loc, setLoc] = useState({ name: '', type: 'CAMP', area: '', address: '', lat: '', lng: '', disasterZoneId: '' });
  const [zone, setZone] = useState({ name: '', hazardType: 'FLOOD', severity: 'HIGH', status: 'ACTIVE', description: '', source: '', sourceUrl: '', lat: '', lng: '', radiusKm: '', isVerified: false });
  const createLoc = useMutation({
    mutationFn: () => {
      const lat = parseCoordinate(loc.lat, 'lat');
      const lng = parseCoordinate(loc.lng, 'lng');
      return placesApi.createLocation({
        name: loc.name.trim(),
        type: loc.type,
        ...(loc.area.trim() ? { area: loc.area.trim() } : {}),
        ...(loc.address.trim() ? { address: loc.address.trim() } : {}),
        ...(lat != null && lng != null ? { latitude: lat, longitude: lng } : {}),
        ...(loc.disasterZoneId ? { disasterZoneId: loc.disasterZoneId } : {}),
      });
    },
    onSuccess: () => (toast('Location added'), qc.invalidateQueries({ queryKey: ['locations'] }), qc.invalidateQueries({ queryKey: ['map'] }), setDialog(null)),
  });
  const createZone = useMutation({
    mutationFn: () => {
      const lat = parseCoordinate(zone.lat, 'lat');
      const lng = parseCoordinate(zone.lng, 'lng');
      return placesApi.createZone({
        name: zone.name.trim(),
        hazardType: zone.hazardType,
        severity: zone.severity,
        status: zone.status,
        source: zone.source.trim(),
        isVerified: zone.isVerified,
        ...(zone.description.trim() ? { description: zone.description.trim() } : {}),
        ...(zone.sourceUrl.trim() ? { sourceUrl: zone.sourceUrl.trim() } : {}),
        ...(lat != null && lng != null ? { centerLat: lat, centerLng: lng } : {}),
        ...(Number(zone.radiusKm) > 0 ? { radiusKm: Number(zone.radiusKm) } : {}),
      });
    },
    onSuccess: () => (toast('Zone published'), qc.invalidateQueries({ queryKey: ['zones'] }), setDialog(null)),
  });
  const updateZone = useMutation({ mutationFn: ({ id, body }) => placesApi.updateZone(id, body), onSuccess: () => qc.invalidateQueries({ queryKey: ['zones'] }) });

  return (
    <div className="stack-lg">
      <section className="stack">
        <div className="row-between">
          <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Disaster zones</h2>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog('zone')}>
            <Plus size={16} /> New zone
          </button>
        </div>
        {zones.isPending && <Loading rows={2} />}
        {zones.isError && <ErrorState error={zones.error} />}
        {zones.data?.map((z) => (
          <div key={z.id} className="card card-tight row-between">
            <div>
              <strong>{z.name}</strong>
              <div className="small muted">
                {HAZARD_LABELS[z.hazardType]} · {z.source} · {z.isVerified ? 'verified' : 'unverified'} · updated {formatDateTime(z.updatedAt)}
              </div>
            </div>
            <div className="row">
              <SeverityBadge severity={z.severity} />
              <select className="input" style={{ width: 'auto' }} aria-label={`Status of ${z.name}`} value={z.status} onChange={(e) => updateZone.mutate({ id: z.id, body: { status: e.target.value } })}>
                <option value="ACTIVE">Active</option>
                <option value="MONITORING">Monitoring</option>
                <option value="CLOSED">Closed</option>
              </select>
              <label className="checkbox small">
                <input type="checkbox" checked={z.isVerified} onChange={(e) => updateZone.mutate({ id: z.id, body: { isVerified: e.target.checked } })} /> Verified
              </label>
            </div>
          </div>
        ))}
      </section>

      <section className="stack">
        <div className="row-between">
          <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Locations</h2>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog('loc')}>
            <Plus size={16} /> New location
          </button>
        </div>
        {locations.isPending && <Loading rows={2} />}
        {locations.isError && <ErrorState error={locations.error} />}
        {locations.data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Area</th>
                  <th scope="col">Coordinates</th>
                </tr>
              </thead>
              <tbody>
                {locations.data.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td>{LOCATION_TYPES[l.type]}</td>
                    <td className="small">{l.area ?? '—'}</td>
                    <td className="small">{l.latitude != null ? `${l.latitude}, ${l.longitude}` : 'Not recorded'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog === 'loc' && (
        <Dialog title="Add a location" onClose={() => setDialog(null)}>
          <form className="stack" onSubmit={(e) => (e.preventDefault(), createLoc.mutate())}>
            <Field label="Name">{(a) => <input {...a} className="input" value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} />}</Field>
            <Field label="Type">
              {(a) => (
                <select {...a} className="input" value={loc.type} onChange={(e) => setLoc({ ...loc, type: e.target.value })}>
                  {Object.entries(LOCATION_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="grid grid-2">
              <Field label="Area">{(a) => <input {...a} className="input" value={loc.area} onChange={(e) => setLoc({ ...loc, area: e.target.value })} />}</Field>
              <Field label="Address">{(a) => <input {...a} className="input" value={loc.address} onChange={(e) => setLoc({ ...loc, address: e.target.value })} />}</Field>
              <Field label="Latitude" hint="Leave empty if not surveyed">{(a) => <input {...a} className="input" inputMode="decimal" value={loc.lat} onChange={(e) => setLoc({ ...loc, lat: e.target.value })} />}</Field>
              <Field label="Longitude">{(a) => <input {...a} className="input" inputMode="decimal" value={loc.lng} onChange={(e) => setLoc({ ...loc, lng: e.target.value })} />}</Field>
            </div>
            <Field label="Inside zone (optional)">
              {(a) => (
                <select {...a} className="input" value={loc.disasterZoneId} onChange={(e) => setLoc({ ...loc, disasterZoneId: e.target.value })}>
                  <option value="">None</option>
                  {(zones.data ?? []).map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {createLoc.isError && <Notice tone="danger">{createLoc.error.message}</Notice>}
            <button className="btn btn-primary" disabled={createLoc.isPending || loc.name.trim().length < 2}>
              Add location
            </button>
          </form>
        </Dialog>
      )}
      {dialog === 'zone' && (
        <Dialog title="Publish a disaster zone" onClose={() => setDialog(null)}>
          <form className="stack" onSubmit={(e) => (e.preventDefault(), createZone.mutate())}>
            <Field label="Name">{(a) => <input {...a} className="input" value={zone.name} onChange={(e) => setZone({ ...zone, name: e.target.value })} />}</Field>
            <div className="grid grid-2">
              <Field label="Hazard">
                {(a) => (
                  <select {...a} className="input" value={zone.hazardType} onChange={(e) => setZone({ ...zone, hazardType: e.target.value })}>
                    {Object.entries(HAZARD_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Severity">
                {(a) => (
                  <select {...a} className="input" value={zone.severity} onChange={(e) => setZone({ ...zone, severity: e.target.value })}>
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {SEVERITY[s].long}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <Field label="Description">{(a) => <textarea {...a} className="input" value={zone.description} onChange={(e) => setZone({ ...zone, description: e.target.value })} />}</Field>
            <div className="grid grid-2">
              <Field label="Source" hint="Who reported this? e.g. District control room">{(a) => <input {...a} className="input" value={zone.source} onChange={(e) => setZone({ ...zone, source: e.target.value })} />}</Field>
              <Field label="Source link (optional)">{(a) => <input {...a} className="input" type="url" value={zone.sourceUrl} onChange={(e) => setZone({ ...zone, sourceUrl: e.target.value })} />}</Field>
              <Field label="Centre latitude">{(a) => <input {...a} className="input" inputMode="decimal" value={zone.lat} onChange={(e) => setZone({ ...zone, lat: e.target.value })} />}</Field>
              <Field label="Centre longitude">{(a) => <input {...a} className="input" inputMode="decimal" value={zone.lng} onChange={(e) => setZone({ ...zone, lng: e.target.value })} />}</Field>
              <Field label="Approximate radius (km)">{(a) => <input {...a} className="input" type="number" min="0" value={zone.radiusKm} onChange={(e) => setZone({ ...zone, radiusKm: e.target.value })} />}</Field>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={zone.isVerified} onChange={(e) => setZone({ ...zone, isVerified: e.target.checked })} />
              <span>I have verified this with an official source</span>
            </label>
            {createZone.isError && <Notice tone="danger">{createZone.error.message}</Notice>}
            <button className="btn btn-primary" disabled={createZone.isPending || zone.name.trim().length < 2 || zone.source.trim().length < 2}>
              Publish zone
            </button>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function Rules() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rules'], queryFn: rulesApi.list });
  const [form, setForm] = useState({ name: '', resultingSeverity: 'HIGH', categories: [], minPeopleAffected: '', minVulnerableCount: '', minAgeMinutes: '', inActiveZone: false });
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: () => {
      const conditions = {};
      if (form.categories.length) conditions.categories = form.categories;
      for (const k of ['minPeopleAffected', 'minVulnerableCount', 'minAgeMinutes']) if (Number(form[k]) > 0) conditions[k] = Number(form[k]);
      if (form.inActiveZone) conditions.inActiveZone = true;
      return rulesApi.create({ name: form.name.trim(), resultingSeverity: form.resultingSeverity, conditions });
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['rules'] }), setOpen(false)),
  });
  const toggle = useMutation({ mutationFn: ({ id, isActive }) => rulesApi.update(id, { isActive }), onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }) });
  const describe = (c) =>
    [
      c.categories?.length ? `category ${c.categories.join('/')}` : null,
      c.minPeopleAffected ? `${c.minPeopleAffected}+ people` : null,
      c.minVulnerableCount ? `${c.minVulnerableCount}+ vulnerable` : null,
      c.minTotalQuantity ? `${c.minTotalQuantity}+ units` : null,
      c.inActiveZone ? 'inside an active zone' : null,
      c.minZoneSeverity ? `zone at least ${SEVERITY[c.minZoneSeverity].label}` : null,
      c.minAgeMinutes ? `waiting ${c.minAgeMinutes}+ min unverified` : null,
    ]
      .filter(Boolean)
      .join(', ');
  if (q.isPending) return <Loading rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return (
    <div className="stack">
      <Notice>Rules suggest a priority when a request arrives; the highest match wins. Staff always confirm or override with a reason. Rules are not medical or rescue decisions.</Notice>
      <div className="row-between">
        <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Severity rules</h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
          <Plus size={16} /> New rule
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Rule</th>
              <th scope="col">When</th>
              <th scope="col">Suggests</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {[...q.data.builtIn, ...q.data.custom].map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  <div className="small muted">{r.editable ? 'Custom' : 'Built-in'}</div>
                </td>
                <td className="small">{describe(r.conditions)}</td>
                <td>
                  <SeverityBadge severity={r.resultingSeverity} />
                </td>
                <td>
                  {r.editable ? (
                    <label className="checkbox small">
                      <input type="checkbox" checked={r.isActive} onChange={(e) => toggle.mutate({ id: r.id, isActive: e.target.checked })} /> Active
                    </label>
                  ) : (
                    <span className="small muted">Always on</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <Dialog title="New severity rule" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
            <Field label="Name">{(a) => <input {...a} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
            <fieldset className="row" style={{ border: 0, padding: 0 }}>
              <legend className="label">Categories (none = any)</legend>
              {CATEGORIES.map((c) => (
                <label key={c.value} className="checkbox small">
                  <input type="checkbox" checked={form.categories.includes(c.value)} onChange={(e) => setForm({ ...form, categories: e.target.checked ? [...form.categories, c.value] : form.categories.filter((x) => x !== c.value) })} />
                  {c.label}
                </label>
              ))}
            </fieldset>
            <div className="grid grid-2">
              <Field label="At least this many people">{(a) => <input {...a} className="input" type="number" min="0" value={form.minPeopleAffected} onChange={(e) => setForm({ ...form, minPeopleAffected: e.target.value })} />}</Field>
              <Field label="At least this many vulnerable">{(a) => <input {...a} className="input" type="number" min="0" value={form.minVulnerableCount} onChange={(e) => setForm({ ...form, minVulnerableCount: e.target.value })} />}</Field>
              <Field label="Waiting unverified (minutes)" hint="Checked by the escalation job">{(a) => <input {...a} className="input" type="number" min="0" value={form.minAgeMinutes} onChange={(e) => setForm({ ...form, minAgeMinutes: e.target.value })} />}</Field>
              <Field label="Suggest">
                {(a) => (
                  <select {...a} className="input" value={form.resultingSeverity} onChange={(e) => setForm({ ...form, resultingSeverity: e.target.value })}>
                    {SEVERITIES.map((s) => (
                      <option key={s} value={s}>
                        {SEVERITY[s].long}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={form.inActiveZone} onChange={(e) => setForm({ ...form, inActiveZone: e.target.checked })} /> Only inside an active disaster zone
            </label>
            {create.isError && <Notice tone="danger">{create.error.details?.[0]?.message ?? create.error.message}</Notice>}
            <button className="btn btn-primary" disabled={create.isPending || form.name.trim().length < 3}>
              Create rule
            </button>
          </form>
        </Dialog>
      )}
    </div>
  );
}

function Audit() {
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audit', entityType, page], queryFn: () => auditApi.list({ entityType: entityType || undefined, page, pageSize: 40 }), placeholderData: (p) => p });
  return (
    <div className="stack">
      <select className="input" style={{ width: 'auto' }} aria-label="Filter by record type" value={entityType} onChange={(e) => (setEntityType(e.target.value), setPage(1))}>
        <option value="">All records</option>
        {['User', 'ReliefRequest', 'Alert', 'InventoryTransaction', 'Allocation', 'Dispatch', 'DisasterZone', 'Location', 'EscalationRule', 'PublicTrackingToken'].map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      {q.isPending && <Loading rows={5} />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && q.data.data.length === 0 && <EmptyState title="No audit entries" />}
      {q.data?.data.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Record</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {q.data.data.map((a) => (
                  <tr key={a.id}>
                    <td className="small">{formatDateTime(a.createdAt)}</td>
                    <td>
                      <span className="code small">{a.action}</span>
                      {a.after?.reason && <div className="small muted">{a.after.reason}</div>}
                    </td>
                    <td className="small">
                      {a.entityType}
                      <div className="muted">{a.entityId?.slice(0, 8)}</div>
                    </td>
                    <td className="small">{a.actor ? `${a.actor.fullName} · ${ROLE_LABELS[a.actor.role]}` : 'System'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="small muted">
              Page {q.data.meta.page} of {q.data.meta.totalPages}
            </span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page >= q.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState('users');
  return (
    <div>
      <PageHead eyebrow="Operations" title="Administration">
        Every change here is written to the audit log with who made it and why.
      </PageHead>
      <Tabs
        label="Administration sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'users', label: 'Users and roles' },
          { value: 'places', label: 'Zones and locations' },
          { value: 'rules', label: 'Severity rules' },
          { value: 'audit', label: 'Audit log' },
        ]}
      />
      {tab === 'users' && <Users />}
      {tab === 'places' && <Places />}
      {tab === 'rules' && <Rules />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}
