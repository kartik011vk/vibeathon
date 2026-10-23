import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Building2, Clock, Copy, KeyRound, ShieldCheck, Truck, UserPlus, Users } from 'lucide-react';
import { organizationsApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/Toast.jsx';
import { Badge, EmptyState, ErrorState, Field, Loading, Notice, PageHead, Tabs } from '../../components/ui/index.jsx';
import { formatDateTime, timeAgo } from '../../lib/format.js';

export const ORG_TYPES = {
  NGO: 'NGO / charity',
  GOVERNMENT: 'Government department',
  VOLUNTEER_GROUP: 'Volunteer group',
  MEDICAL: 'Medical service',
  PRIVATE_COMPANY: 'Company',
  OTHER: 'Other',
};

const ORG_STATUS = {
  PENDING: ['Waiting for approval', 'sev-HIGH'],
  APPROVED: ['Approved', 'avail-AVAILABLE'],
  REJECTED: ['Not approved', 'sev-RED'],
  SUSPENDED: ['Suspended', 'sev-RED'],
};

function validateAccount(a) {
  const e = {};
  if (a.fullName.trim().length < 2) e.fullName = 'Please enter your name.';
  if (!/^\S+@\S+\.\S+$/.test(a.email.trim())) e.email = 'Enter a valid email address.';
  if (a.phone && !/^\+?[0-9 ()-]{7,20}$/.test(a.phone.trim())) e.phone = 'Enter a valid phone number, or leave it empty.';
  if (a.password.length < 10 || !/[A-Za-z]/.test(a.password) || !/[0-9]/.test(a.password)) e.password = 'At least 10 characters, with a letter and a number.';
  return e;
}

function AccountFields({ account, setAccount, errors, nameLabel = 'Your full name' }) {
  const set = (k) => (e) => setAccount({ ...account, [k]: e.target.value });
  return (
    <div className="grid grid-2">
      <Field label={nameLabel} error={errors.fullName}>{(a) => <input {...a} className="input" autoComplete="name" value={account.fullName} onChange={set('fullName')} />}</Field>
      <Field label="Email" error={errors.email}>{(a) => <input {...a} className="input" type="email" autoComplete="email" value={account.email} onChange={set('email')} />}</Field>
      <Field label="Phone (optional)" error={errors.phone}>{(a) => <input {...a} className="input" type="tel" autoComplete="tel" value={account.phone} onChange={set('phone')} />}</Field>
      <Field label="Password" hint="At least 10 characters, a letter and a number." error={errors.password}>
        {(a) => <input {...a} className="input" type="password" autoComplete="new-password" value={account.password} onChange={set('password')} />}
      </Field>
    </div>
  );
}

const cleanAccount = (a) => ({ fullName: a.fullName.trim(), email: a.email.trim(), password: a.password, ...(a.phone.trim() ? { phone: a.phone.trim() } : {}) });

function RegisterOrgForm() {
  const { startSession } = useAuth();
  const navigate = useNavigate();
  const [org, setOrg] = useState({ name: '', type: 'NGO', area: '', contactPhone: '', description: '' });
  const [account, setAccount] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const setO = (k) => (e) => setOrg({ ...org, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    const v = validateAccount(account);
    if (org.name.trim().length < 3) v.name = 'Enter the organisation name.';
    if (org.area.trim().length < 2) v.area = 'Where do you operate?';
    if (!/^\+?[0-9 ()-]{7,20}$/.test(org.contactPhone.trim())) v.contactPhone = 'A contact number is required so admins can verify you.';
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await organizationsApi.register({
        organization: { name: org.name.trim(), type: org.type, area: org.area.trim(), contactPhone: org.contactPhone.trim(), ...(org.description.trim() ? { description: org.description.trim() } : {}) },
        account: cleanAccount(account),
      });
      await startSession(result);
      navigate('/organization', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <form className="stack-lg" onSubmit={submit} noValidate>
      <div className="card stack">
        <h2 style={{ fontSize: '1.25rem', margin: 0 }}>
          <Building2 size={18} aria-hidden="true" /> Your organisation
        </h2>
        <div className="grid grid-2">
          <Field label="Organisation name" error={errors.name}>{(a) => <input {...a} className="input" value={org.name} onChange={setO('name')} />}</Field>
          <Field label="Type">
            {(a) => (
              <select {...a} className="input" value={org.type} onChange={setO('type')}>
                {Object.entries(ORG_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Area you serve" hint="District, city or region" error={errors.area}>{(a) => <input {...a} className="input" value={org.area} onChange={setO('area')} />}</Field>
          <Field label="Office contact number" error={errors.contactPhone}>{(a) => <input {...a} className="input" type="tel" value={org.contactPhone} onChange={setO('contactPhone')} />}</Field>
        </div>
        <Field label="What can you do? (optional)" hint="Vehicles, volunteers, medical staff, storage…">
          {(a) => <textarea {...a} className="input" style={{ minHeight: 80 }} maxLength={1000} value={org.description} onChange={setO('description')} />}
        </Field>
      </div>
      <div className="card stack">
        <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Your account (organisation lead)</h2>
        <AccountFields account={account} setAccount={setAccount} errors={errors} />
      </div>
      <Notice icon={ShieldCheck} title="What happens next">
        A DisplaceOS administrator checks every organisation before it can see requests or deliver. You will be notified when you are approved. Until then your account works like a normal citizen account.
      </Notice>
      {error && <Notice tone="danger" title="Registration failed">{error.message}</Notice>}
      <button className="btn btn-primary btn-lg" disabled={busy} style={{ alignSelf: 'flex-start' }}>
        {busy ? 'Sending…' : 'Register organisation'}
      </button>
    </form>
  );
}

function JoinOrgForm() {
  const { startSession } = useAuth();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [account, setAccount] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const v = validateAccount(account);
    if (joinCode.replace(/[^A-Za-z0-9]/g, '').length !== 8) v.joinCode = 'The join code has 8 letters and digits, like AB12-CD34.';
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await organizationsApi.join({ joinCode: joinCode.trim(), account: cleanAccount(account) });
      await startSession(result);
      navigate('/organization', { replace: true });
    } catch (err) {
      setError(err.status === 404 ? { message: 'That join code is not valid. Ask your organisation lead for a new one.' } : err);
      setBusy(false);
    }
  };
  return (
    <form className="stack-lg" onSubmit={submit} noValidate>
      <div className="card stack">
        <Field label="Join code from your organisation lead" error={errors.joinCode}>
          {(a) => <input {...a} className="input" style={{ maxWidth: 240, letterSpacing: '0.15em', textTransform: 'uppercase' }} placeholder="AB12-CD34" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />}
        </Field>
        <AccountFields account={account} setAccount={setAccount} errors={errors} />
      </div>
      <Notice icon={ShieldCheck}>Your lead approves every new member before they can see deliveries.</Notice>
      {error && <Notice tone="danger" title="Could not join">{error.message}</Notice>}
      <button className="btn btn-primary btn-lg" disabled={busy} style={{ alignSelf: 'flex-start' }}>
        {busy ? 'Sending…' : 'Join organisation'}
      </button>
    </form>
  );
}

export function JoinResponderPage() {
  const { status, user } = useAuth();
  const [tab, setTab] = useState('register');
  if (status === 'authenticated' && user.organization) return <Navigate to="/organization" replace />;
  return (
    <div className="container" style={{ maxWidth: 920 }}>
      <PageHead eyebrow="For rescue teams, NGOs and government" title="Join DisplaceOS as a responder">
        Responder accounts are separate from citizen accounts. Once approved, your team sees verified needs, offers to deliver, and shares its live position with the families it is driving to.
      </PageHead>
      <div className="grid grid-3" style={{ marginBottom: 24 }}>
        {[
          [Building2, '1. Register', 'Your organisation and its lead account.'],
          [BadgeCheck, '2. Get approved', 'An administrator verifies you, then your team is created.'],
          [Truck, '3. Deliver', 'See open needs, offer to deliver, accept dispatches and share your location.'],
        ].map(([Icon, title, body]) => (
          <div key={title} className="card card-tight">
            <Icon size={20} color="var(--orange-deep)" aria-hidden="true" />
            <strong style={{ display: 'block', marginTop: 6 }}>{title}</strong>
            <span className="small muted">{body}</span>
          </div>
        ))}
      </div>
      {status === 'authenticated' && !user.organization && (
        <Notice tone="warn" title="You are signed in with a citizen account">
          Responder accounts use their own email address. Sign out first, or use a different email below.
        </Notice>
      )}
      <Tabs
        label="Responder sign-up"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'register', label: 'Register a new organisation' },
          { value: 'join', label: 'Join my organisation with a code' },
        ]}
      />
      {tab === 'register' ? <RegisterOrgForm /> : <JoinOrgForm />}
      <p className="small" style={{ marginTop: 16 }}>
        Already have a responder account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}

function JoinCodePanel() {
  const toast = useToast();
  const [code, setCode] = useState(null);
  const m = useMutation({ mutationFn: organizationsApi.rotateJoinCode, onSuccess: (d) => setCode(d.joinCode) });
  return (
    <div className="card stack">
      <h2 style={{ fontSize: '1.15rem', margin: 0 }}>
        <KeyRound size={18} aria-hidden="true" /> Invite members
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        Share a join code with your volunteers. They sign up at “Join as a responder”, and you approve each one below. Making a new code switches the old one off.
      </p>
      {code && (
        <div className="row">
          <span className="ref-code" style={{ fontSize: '1.4rem' }}>
            {code}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(code).then(() => toast('Code copied'))}>
            <Copy size={14} /> Copy
          </button>
        </div>
      )}
      {code && <span className="small muted">Shown once. Write it down or share it now.</span>}
      {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
      <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => m.mutate()} disabled={m.isPending}>
        {code ? 'Make another code' : 'Make a join code'}
      </button>
    </div>
  );
}

export function OrganizationPage() {
  const { refreshUser, user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['organization', 'mine'], queryFn: organizationsApi.mine, refetchInterval: 30000 });
  const decide = useMutation({
    mutationFn: ({ id, decision }) => organizationsApi.decideMember(id, decision),
    onSuccess: (data, v) => {
      qc.setQueryData(['organization', 'mine'], data);
      toast(v.decision === 'APPROVE' ? 'Member approved' : 'Member declined');
    },
  });

  // Approval happens on the server; pick up the new responder role without asking the user to sign in again.
  const approvedNow = q.data?.status === 'APPROVED' && q.data?.myMembershipStatus === 'APPROVED' && user.role !== 'RESPONSE_TEAM';
  useEffect(() => {
    if (approvedNow) refreshUser();
  }, [approvedNow, refreshUser]);

  if (q.isPending) return <Loading label="Loading your organisation…" />;
  if (q.isError) {
    return (
      <div className="container section">
        {q.error.status === 404 ? (
          <EmptyState title="You are not part of a responder organisation" action={<Link to="/join-responder" className="btn btn-primary">Join as a responder</Link>} />
        ) : (
          <ErrorState error={q.error} onRetry={q.refetch} />
        )}
      </div>
    );
  }
  const o = q.data;
  const [statusLabel, statusClass] = ORG_STATUS[o.status];
  const waitingForMe = o.myMembershipStatus === 'PENDING';
  return (
    <div className="container">
      <PageHead eyebrow={ORG_TYPES[o.type]} title={o.name}>
        {o.area}
      </PageHead>
      <div className="row" style={{ marginBottom: 20 }}>
        <Badge className={statusClass}>{statusLabel}</Badge>
        <Badge outline>{o.myRole === 'LEAD' ? 'You are the lead' : 'Member'}</Badge>
        {o.myMembershipStatus === 'PENDING' && o.status === 'APPROVED' && <Badge outline>Your membership is waiting for the lead</Badge>}
      </div>

      {o.status === 'PENDING' && (
        <Notice icon={Clock} title="Waiting for an administrator">
          Your organisation was registered {timeAgo(o.createdAt)}. An administrator will verify it — you will get a notification. Meanwhile you can use DisplaceOS like any citizen.
        </Notice>
      )}
      {o.status === 'REJECTED' && (
        <Notice tone="danger" title="Your organisation was not approved">
          {o.reviewNote}
        </Notice>
      )}
      {o.status === 'APPROVED' && waitingForMe && (
        <Notice icon={Clock} title="Waiting for your organisation lead">
          Your lead will approve you. You will get a notification, then you can open Operations → Open needs.
        </Notice>
      )}
      {o.status === 'APPROVED' && !waitingForMe && o.myMembershipStatus === 'APPROVED' && (
        <Notice icon={BadgeCheck} title="You are an approved responder">
          See requests that still need a delivery in <Link to="/ops/needs">Open needs</Link>, and your assigned deliveries in <Link to="/ops/dispatch">Dispatch</Link>.{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => refreshUser()}>
            Refresh my access
          </button>
        </Notice>
      )}
      {o.myMembershipStatus === 'REJECTED' && <Notice tone="danger">Your request to join was declined. Contact the organisation lead.</Notice>}

      <div className="grid grid-2" style={{ marginTop: 20, alignItems: 'start' }}>
        <div className="stack-lg">
          {o.isLead && <JoinCodePanel />}
          <div className="card">
            <h2 style={{ fontSize: '1.15rem' }}>
              <Truck size={18} aria-hidden="true" /> Teams
            </h2>
            {o.teams.length === 0 ? (
              <p className="small muted">Your team is created automatically when the organisation is approved.</p>
            ) : (
              <ul className="list">
                {o.teams.map((t) => (
                  <li key={t.id} className="list-item">
                    <div className="row-between">
                      <strong>{t.name}</strong>
                      <Badge>{t.availability.replace('_', ' ').toLowerCase()}</Badge>
                    </div>
                    <span className="small muted">{t.members.map((m) => m.fullName).join(', ') || 'No members yet'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {o.isLead && (
          <div className="card">
            <h2 style={{ fontSize: '1.15rem' }}>
              <Users size={18} aria-hidden="true" /> Members {o.pendingMembers ? <Badge className="sev-HIGH">{o.pendingMembers} waiting</Badge> : null}
            </h2>
            <ul className="list">
              {o.members.map((m) => (
                <li key={m.id} className="list-item row-between">
                  <span>
                    <strong>{m.fullName}</strong>
                    <span className="small muted">
                      {' '}
                      · {m.email}
                      {m.phone ? ` · ${m.phone}` : ''} · joined {formatDateTime(m.createdAt)}
                    </span>
                  </span>
                  {m.membershipStatus === 'PENDING' ? (
                    <span className="row">
                      <button type="button" className="btn btn-primary btn-sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: m.id, decision: 'APPROVE' })}>
                        <UserPlus size={14} /> Approve
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: m.id, decision: 'REJECT' })}>
                        Decline
                      </button>
                    </span>
                  ) : (
                    <Badge outline>{m.orgRole === 'LEAD' ? 'Lead' : m.membershipStatus === 'APPROVED' ? 'Approved' : 'Declined'}</Badge>
                  )}
                </li>
              ))}
            </ul>
            {decide.isError && <Notice tone="danger">{decide.error.message}</Notice>}
          </div>
        )}
      </div>
    </div>
  );
}
