import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpCircle, CheckCircle2, Lightbulb, PackageCheck, Truck } from 'lucide-react';
import { allocationsApi, dispatchesApi, requestsApi, teamsApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/Toast.jsx';
import { Badge, Dialog, ErrorState, Field, Loading, Notice, ReasonDialog, SeverityBadge } from '../../components/ui/index.jsx';
import { distanceLabel, LOCATION_TYPES, num, SEVERITIES, SEVERITY } from '../../lib/format.js';

const ALLOC_STATUS = { PROPOSED: 'Waiting for approval', APPROVED: 'Stock reserved', REJECTED: 'Rejected', RELEASED: 'Released', DISPATCHED: 'Dispatched', FULFILLED: 'Completed' };

function VerifyForm({ request, onDone }) {
  const { hasRole } = useAuth();
  const toast = useToast();
  const [decision, setDecision] = useState('VERIFY');
  const [reason, setReason] = useState('');
  const [severity, setSeverity] = useState('');
  const m = useMutation({
    mutationFn: () => requestsApi.verify(request.id, { decision, reason: reason.trim(), ...(decision === 'VERIFY' && severity ? { severity } : {}) }),
    onSuccess: () => {
      toast(decision === 'VERIFY' ? 'Request verified' : 'Request rejected');
      onDone();
    },
  });
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim().length >= 3) m.mutate();
      }}
    >
      <h2 style={{ fontSize: '1.15rem', margin: 0 }}>
        <CheckCircle2 size={18} aria-hidden="true" /> Review this request
      </h2>
      <div className="notice notice-info small">
        <div>
          Rules suggest <SeverityBadge severity={request.suggestedSeverity} />
          <div className="muted" style={{ marginTop: 4 }}>
            {request.severityReason}
          </div>
        </div>
      </div>
      <div className="row" role="radiogroup" aria-label="Decision">
        {['VERIFY', 'REJECT'].map((d) => (
          <button key={d} type="button" role="radio" aria-checked={decision === d} className={`btn btn-sm ${decision === d ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDecision(d)}>
            {d === 'VERIFY' ? 'Verify' : 'Reject'}
          </button>
        ))}
      </div>
      {decision === 'VERIFY' && hasRole('RELIEF_COORDINATOR', 'ADMIN') && (
        <Field label="Priority" hint="Keep the rule suggestion unless you have information it does not. Overrides are audited.">
          {(a) => (
            <select {...a} className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Keep suggestion ({SEVERITY[request.suggestedSeverity].label})</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY[s].long}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label={decision === 'VERIFY' ? 'How was this checked?' : 'Reason for rejecting'} hint="Required. The requester sees rejection reasons.">
        {(a) => <textarea {...a} className="input" style={{ minHeight: 80 }} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
      </Field>
      {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
      <button className="btn btn-primary" disabled={m.isPending || reason.trim().length < 3}>
        {m.isPending ? 'Saving…' : decision === 'VERIFY' ? 'Verify request' : 'Reject request'}
      </button>
    </form>
  );
}

function EscalateDialog({ request, onClose, onDone }) {
  const higher = SEVERITIES.filter((s) => SEVERITIES.indexOf(s) > SEVERITIES.indexOf(request.severity));
  const [severity, setSeverity] = useState(higher[0]);
  return (
    <ReasonDialog
      title="Raise priority"
      description="RED and HIGHEST PRIORITY create or escalate an alert for all coordinators."
      confirmLabel="Raise priority"
      onClose={onClose}
      extra={
        <Field label="New priority">
          {(a) => (
            <select {...a} className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              {higher.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY[s].long}
                </option>
              ))}
            </select>
          )}
        </Field>
      }
      onConfirm={async (reason) => {
        await requestsApi.escalate(request.id, { severity, reason });
        onDone();
      }}
    />
  );
}

function Suggestions({ request, onDone }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['suggestions', request.id], queryFn: () => allocationsApi.suggestions(request.id) });
  const [editing, setEditing] = useState(null); // candidate being proposed
  const [qty, setQty] = useState({});
  const create = useMutation({
    mutationFn: () =>
      allocationsApi.create({
        requestId: request.id,
        sourceLocationId: editing.location.id,
        lines: editing.lines.map((l) => ({ requestItemId: l.requestItemId, quantity: Number(qty[l.requestItemId] ?? l.proposedQuantity) })).filter((l) => l.quantity > 0),
        rationale: editing.rationale,
      }),
    onSuccess: () => {
      toast('Allocation proposed');
      setEditing(null);
      onDone();
    },
  });

  if (q.isPending) return <Loading rows={2} label="Finding stock…" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const s = q.data;
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        {s.method}
      </p>
      {s.notes.map((n) => (
        <Notice key={n} tone="warn">
          {n}
        </Notice>
      ))}
      {s.outstanding.length === 0 && <p className="small">Everything requested is already delivered or covered by allocations.</p>}
      {s.outstanding.length > 0 && s.candidates.length === 0 && <Notice tone="warn">No stock location has unreserved stock of these items.</Notice>}
      {s.candidates.map((c) => (
        <div key={c.location.id} className="card card-tight card-cream">
          <div className="row-between">
            <strong>{c.location.name}</strong>
            {c.fullyCovers ? <Badge className="sev-HIGH">Covers everything</Badge> : <Badge outline>Partial</Badge>}
          </div>
          <div className="small muted">
            {LOCATION_TYPES[c.location.type]} · {distanceLabel(c.distanceKm)}
          </div>
          <ul className="small" style={{ margin: '8px 0' }}>
            {c.lines.map((l) => (
              <li key={l.requestItemId}>
                {l.name}: propose {num(l.proposedQuantity)} of {num(l.outstanding)} {l.unit} needed (available {num(l.available)})
              </li>
            ))}
          </ul>
          <ul className="small muted" style={{ margin: '0 0 8px' }}>
            {c.rationale.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => (setEditing(c), setQty({}))}>
            Propose from here
          </button>
        </div>
      ))}
      {editing && (
        <Dialog title={`Propose allocation from ${editing.location.name}`} onClose={() => setEditing(null)}>
          <div className="stack">
            {editing.lines.map((l) => (
              <Field key={l.requestItemId} label={`${l.name} (${l.unit})`} hint={`Up to ${Math.min(l.available, l.outstanding)}`}>
                {(a) => (
                  <input
                    {...a}
                    className="input"
                    type="number"
                    min="0"
                    max={Math.min(l.available, l.outstanding)}
                    value={qty[l.requestItemId] ?? l.proposedQuantity}
                    onChange={(e) => setQty({ ...qty, [l.requestItemId]: e.target.value })}
                  />
                )}
              </Field>
            ))}
            {create.isError && <Notice tone="danger">{create.error.message}</Notice>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Back
              </button>
              <button type="button" className="btn btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
                Propose
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function DispatchDialog({ allocation, onClose, onDone }) {
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => teamsApi.list() });
  const [teamId, setTeamId] = useState('');
  const [notes, setNotes] = useState('');
  const m = useMutation({ mutationFn: () => dispatchesApi.create({ allocationId: allocation.id, teamId, ...(notes.trim() ? { notes: notes.trim() } : {}) }), onSuccess: () => (onDone(), onClose()) });
  return (
    <Dialog title="Assign a response team" onClose={onClose}>
      <div className="stack">
        {teams.isPending && <Loading rows={2} />}
        {teams.isError && <ErrorState error={teams.error} />}
        {teams.data && (
          <Field label="Team">
            {(a) => (
              <select {...a} className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">Choose a team…</option>
                {teams.data.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.availability === 'OFF_DUTY'}>
                    {t.name} — {t.availability.replace('_', ' ').toLowerCase()}
                    {Array.isArray(t.activeDispatches) && t.activeDispatches.length ? ` (${t.activeDispatches.length} active)` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label="Notes for the team (optional)">{(a) => <textarea {...a} className="input" style={{ minHeight: 70 }} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button type="button" className="btn btn-primary" disabled={!teamId || m.isPending} onClick={() => m.mutate()}>
            Create dispatch
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function Allocations({ request, onDone }) {
  const { user, hasRole } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState(null);
  const [showSuggest, setShowSuggest] = useState(false);
  const q = useQuery({ queryKey: ['allocations', request.id], queryFn: () => allocationsApi.list({ requestId: request.id, pageSize: 50 }) });
  const changed = () => {
    qc.invalidateQueries({ queryKey: ['allocations'] });
    qc.invalidateQueries({ queryKey: ['suggestions', request.id] });
    onDone();
  };
  const approve = useMutation({ mutationFn: allocationsApi.approve, onSuccess: () => (toast('Stock reserved'), changed()) });
  const coordinator = hasRole('RELIEF_COORDINATOR', 'ADMIN');
  const canApprove = (a) => coordinator || (user.role === 'INVENTORY_MANAGER' && user.assignedLocations.some((l) => l.id === a.sourceLocation.id));
  const allocatable = ['VERIFIED', 'ALLOCATED', 'DISPATCHED', 'PARTIALLY_DELIVERED'].includes(request.status);

  return (
    <div className="card stack">
      <div className="row-between">
        <h2 style={{ fontSize: '1.15rem', margin: 0 }}>
          <PackageCheck size={18} aria-hidden="true" /> Supplies for this request
        </h2>
        {coordinator && allocatable && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowSuggest((v) => !v)} aria-expanded={showSuggest}>
            <Lightbulb size={16} /> {showSuggest ? 'Hide suggestions' : 'Find stock'}
          </button>
        )}
      </div>
      {!allocatable && request.status === 'SUBMITTED' && <p className="small muted">Verify the request before allocating stock.</p>}
      {showSuggest && <Suggestions request={request} onDone={changed} />}
      {q.isPending && <Loading rows={1} />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data?.data.length === 0 && <p className="small muted">No allocations yet.</p>}
      {q.data?.data.map((a) => (
        <div key={a.id} className="card card-tight">
          <div className="row-between">
            <strong>{a.sourceLocation.name}</strong>
            <Badge>{ALLOC_STATUS[a.status]}</Badge>
          </div>
          <ul className="small" style={{ margin: '6px 0' }}>
            {a.lines.map((l) => (
              <li key={l.id}>
                {num(l.quantity)} {l.item.unit} — {l.item.name}
              </li>
            ))}
          </ul>
          <div className="row">
            {a.status === 'PROPOSED' && canApprove(a) && (
              <>
                <button type="button" className="btn btn-primary btn-sm" disabled={approve.isPending} onClick={() => approve.mutate(a.id)}>
                  Approve and reserve
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'reject', a })}>
                  Reject
                </button>
              </>
            )}
            {a.status === 'APPROVED' && coordinator && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'dispatch', a })}>
                <Truck size={16} /> Assign team
              </button>
            )}
            {a.status === 'APPROVED' && canApprove(a) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ kind: 'release', a })}>
                Release stock
              </button>
            )}
          </div>
          {approve.isError && approve.variables === a.id && <Notice tone="danger">{approve.error.message}</Notice>}
        </div>
      ))}
      {dialog?.kind === 'reject' && (
        <ReasonDialog title="Reject allocation" onClose={() => setDialog(null)} confirmLabel="Reject" tone="danger" onConfirm={async (r) => (await allocationsApi.reject(dialog.a.id, r), changed())} />
      )}
      {dialog?.kind === 'release' && (
        <ReasonDialog
          title="Release reserved stock"
          description="The reserved quantities go back to available stock."
          onClose={() => setDialog(null)}
          confirmLabel="Release"
          tone="danger"
          onConfirm={async (r) => (await allocationsApi.release(dialog.a.id, r), changed())}
        />
      )}
      {dialog?.kind === 'dispatch' && <DispatchDialog allocation={dialog.a} onClose={() => setDialog(null)} onDone={() => (toast('Dispatch created'), changed())} />}
    </div>
  );
}

export default function StaffRequestPanel({ request, onChanged }) {
  const { hasRole } = useAuth();
  const [escalating, setEscalating] = useState(false);
  const open = ['SUBMITTED', 'VERIFIED', 'ALLOCATED', 'DISPATCHED', 'PARTIALLY_DELIVERED'].includes(request.status);
  return (
    <div className="stack-lg">
      {request.status === 'SUBMITTED' && hasRole('RELIEF_COORDINATOR', 'ADMIN', 'CAMP_MANAGER') && <VerifyForm request={request} onDone={onChanged} />}
      {open && hasRole('RELIEF_COORDINATOR', 'ADMIN') && request.severity !== 'HYPER_RED' && (
        <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={() => setEscalating(true)}>
          <ArrowUpCircle size={16} /> Raise priority
        </button>
      )}
      {hasRole('RELIEF_COORDINATOR', 'ADMIN', 'INVENTORY_MANAGER', 'CAMP_MANAGER') && <Allocations request={request} onDone={onChanged} />}
      {escalating && <EscalateDialog request={request} onClose={() => setEscalating(false)} onDone={onChanged} />}
    </div>
  );
}
