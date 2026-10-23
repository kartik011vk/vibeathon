import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { alertsApi, placesApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/Toast.jsx';
import { Badge, Dialog, EmptyState, ErrorState, Field, Loading, Notice, PageHead, ReasonDialog, SeverityBadge, Stat, Tabs } from '../../components/ui/index.jsx';
import { formatDateTime, SEVERITIES, SEVERITY, timeAgo } from '../../lib/format.js';

function CreateAlert({ onClose }) {
  const qc = useQueryClient();
  const zones = useQuery({ queryKey: ['zones', 'all'], queryFn: () => placesApi.zones() });
  const [form, setForm] = useState({ title: '', message: '', severity: 'HIGH', disasterZoneId: '' });
  const m = useMutation({
    mutationFn: () => alertsApi.create({ title: form.title.trim(), message: form.message.trim(), severity: form.severity, ...(form.disasterZoneId ? { disasterZoneId: form.disasterZoneId } : {}) }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['alerts'] }), onClose()),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Dialog title="Publish an alert" onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
        <Notice tone="warn">Alerts linked to an area (and not to a request) are shown publicly on Disaster updates. Write only what has been confirmed.</Notice>
        <Field label="Title">{(a) => <input {...a} className="input" maxLength={160} value={form.title} onChange={set('title')} />}</Field>
        <Field label="Message">{(a) => <textarea {...a} className="input" maxLength={2000} value={form.message} onChange={set('message')} />}</Field>
        <div className="grid grid-2">
          <Field label="Severity">
            {(a) => (
              <select {...a} className="input" value={form.severity} onChange={set('severity')}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {SEVERITY[s].long}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Area (optional)">
            {(a) => (
              <select {...a} className="input" value={form.disasterZoneId} onChange={set('disasterZoneId')}>
                <option value="">No area</option>
                {(zones.data ?? []).map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button className="btn btn-primary" disabled={m.isPending || form.title.trim().length < 3 || form.message.trim().length < 3}>
            Publish alert
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AlertCard({ a, canAck, canManage, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const [dialog, setDialog] = useState(null);
  const ack = useMutation({ mutationFn: () => alertsApi.acknowledge(a.id), onSuccess: () => (toast('Acknowledged'), onChanged()) });
  const already = a.acknowledgements?.some((x) => x.userId === user.id);
  const higher = SEVERITIES.filter((s) => SEVERITIES.indexOf(s) > SEVERITIES.indexOf(a.severity));
  const [newSev, setNewSev] = useState(higher[0]);
  return (
    <article className="card">
      <div className="row-between">
        <div className="row">
          <SeverityBadge severity={a.severity} />
          <Badge outline>{a.status === 'ACTIVE' ? 'Needs attention' : a.status === 'ACKNOWLEDGED' ? 'Acknowledged' : 'Resolved'}</Badge>
          {a.escalationLevel > 0 && <Badge>Escalated ×{a.escalationLevel}</Badge>}
        </div>
        <span className="small muted">{timeAgo(a.createdAt)}</span>
      </div>
      <h3 style={{ marginTop: 10 }}>{a.title}</h3>
      <p style={{ whiteSpace: 'pre-line' }}>{a.message}</p>
      <div className="small muted">
        Source: {a.source}
        {a.request && (
          <>
            {' '}
            · Request <Link to={`/requests/${a.request.id}`}>{a.request.referenceCode}</Link>
          </>
        )}
        {a.disasterZone && ` · ${a.disasterZone.name}`}
        {a.acknowledgements?.length > 0 && ` · acknowledged by ${a.acknowledgements.map((x) => x.user.fullName).join(', ')}`}
        {a.resolvedAt && ` · resolved ${formatDateTime(a.resolvedAt)}: ${a.resolutionNote}`}
      </div>
      {a.status !== 'RESOLVED' && (
        <div className="row" style={{ marginTop: 12 }}>
          {canAck && !already && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => ack.mutate()} disabled={ack.isPending}>
              Acknowledge
            </button>
          )}
          {canManage && higher.length > 0 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('escalate')}>
              Escalate
            </button>
          )}
          {canManage && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog('resolve')}>
              Resolve
            </button>
          )}
        </div>
      )}
      {ack.isError && <Notice tone="danger">{ack.error.message}</Notice>}
      {dialog === 'resolve' && (
        <ReasonDialog title="Resolve alert" description="Describe what was done. This note is kept in the audit log." confirmLabel="Resolve" onClose={() => setDialog(null)} onConfirm={async (note) => (await alertsApi.resolve(a.id, note), onChanged())} />
      )}
      {dialog === 'escalate' && (
        <ReasonDialog
          title="Escalate alert"
          onClose={() => setDialog(null)}
          confirmLabel="Escalate"
          extra={
            <Field label="New severity">
              {(x) => (
                <select {...x} className="input" value={newSev} onChange={(e) => setNewSev(e.target.value)}>
                  {higher.map((s) => (
                    <option key={s} value={s}>
                      {SEVERITY[s].long}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          }
          onConfirm={async (reason) => (await alertsApi.escalate(a.id, { severity: newSev, reason }), onChanged())}
        />
      )}
    </article>
  );
}

export default function AlertsPage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState('open');
  const [creating, setCreating] = useState(false);
  const summary = useQuery({ queryKey: ['alerts', 'summary'], queryFn: alertsApi.summary, refetchInterval: 60000 });
  const list = useQuery({
    queryKey: ['alerts', 'list', tab],
    queryFn: () => (tab === 'open' ? alertsApi.active() : alertsApi.list({ status: 'RESOLVED', pageSize: 50 })),
    refetchInterval: 45000,
  });
  const canManage = hasRole('RELIEF_COORDINATOR', 'ADMIN');
  const canAck = hasRole('RELIEF_COORDINATOR', 'ADMIN', 'CAMP_MANAGER');
  const changed = () => qc.invalidateQueries({ queryKey: ['alerts'] });

  return (
    <div>
      <PageHead
        eyebrow="Operations"
        title="Alerts"
        actions={
          canManage && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> Publish alert
            </button>
          )
        }
      >
        Critical and highest-priority requests raise alerts automatically. Every acknowledgement, escalation and resolution is recorded.
      </PageHead>
      {summary.data && (
        <div className="grid grid-4" style={{ marginBottom: 20 }}>
          {SEVERITIES.slice()
            .reverse()
            .map((s) => (
              <Stat key={s} label={`Open · ${SEVERITY[s].label}`} value={summary.data.openBySeverity[s]} />
            ))}
        </div>
      )}
      <Tabs
        label="Alert lists"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'open', label: 'Open' },
          { value: 'resolved', label: 'Resolved' },
        ]}
      />
      {list.isPending && <Loading rows={3} />}
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data && list.data.data.length === 0 && <EmptyState title={tab === 'open' ? 'No open alerts' : 'No resolved alerts yet'} />}
      <div className="stack">
        {list.data?.data.map((a) => (
          <AlertCard key={a.id} a={a} canAck={canAck} canManage={canManage} onChanged={changed} />
        ))}
      </div>
      {creating && <CreateAlert onClose={() => setCreating(false)} />}
    </div>
  );
}
