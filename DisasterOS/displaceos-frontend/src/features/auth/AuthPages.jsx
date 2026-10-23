import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/Toast.jsx';
import { authApi, notificationsApi } from '../../api/services.js';
import { ErrorState, Field, Loading, Notice, PageHead } from '../../components/ui/index.jsx';
import { ROLE_LABELS, SEVERITIES, SEVERITY } from '../../lib/format.js';

const DEMO_ACCOUNTS = [
  ['citizen@displaceos.dev', 'Citizen'],
  ['coordinator@displaceos.dev', 'Relief coordinator'],
  ['camp.manager@displaceos.dev', 'Camp manager'],
  ['inventory@displaceos.dev', 'Inventory manager'],
  ['team.alpha@displaceos.dev', 'Response team'],
  ['admin@displaceos.dev', 'Admin'],
];

function homeFor(user) {
  return user.role === 'CITIZEN' ? '/track' : '/ops';
}

export function LoginPage() {
  const { login, status, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const from = location.state?.from;

  if (status === 'authenticated') return <Navigate to={from ?? homeFor(user)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await login(form.email.trim(), form.password);
      navigate(from ?? homeFor(me), { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 520 }}>
      <PageHead title="Sign in">Use the account you registered with. Staff accounts are created by an administrator.</PageHead>
      <form className="card stack" onSubmit={submit} noValidate>
        {error && (
          <Notice tone="danger" title="Could not sign in">
            {error.code === 'RATE_LIMITED' ? 'Too many attempts. Please wait a few minutes and try again.' : error.message}
          </Notice>
        )}
        <Field label="Email">
          {(a) => <input {...a} className="input" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label="Password">
          {(a) => <input {...a} className="input" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <button className="btn btn-primary btn-lg" disabled={busy || !form.email || !form.password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="small" style={{ margin: 0 }}>
          New here? <Link to="/register" state={location.state}>Create a free account</Link> to request supplies.
        </p>
      </form>
      {import.meta.env.DEV && (
        <div className="card card-cream" style={{ marginTop: 16 }}>
          <strong>Development demo accounts</strong>
          <p className="small muted" style={{ marginBottom: 8 }}>
            Created by the backend seed script for local testing only. Password for all: <span className="code">DemoPass2026!</span>
          </p>
          <div className="row">
            {DEMO_ACCOUNTS.map(([email, label]) => (
              <button key={email} type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ email, password: 'DemoPass2026!' })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RegisterPage() {
  const { register, status, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated') return <Navigate to={location.state?.from ?? homeFor(user)} replace />;

  const validate = () => {
    const e = {};
    if (form.fullName.trim().length < 2) e.fullName = 'Please enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) e.email = 'Enter a valid email address.';
    if (form.phone && !/^\+?[0-9 ()-]{7,20}$/.test(form.phone.trim())) e.phone = 'Enter a valid phone number, or leave it empty.';
    if (form.password.length < 10 || !/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) e.password = 'At least 10 characters, with a letter and a number.';
    return e;
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setError(null);
    try {
      const me = await register({ fullName: form.fullName.trim(), email: form.email.trim(), password: form.password, ...(form.phone.trim() ? { phone: form.phone.trim() } : {}) });
      navigate(location.state?.from ?? homeFor(me), { replace: true });
    } catch (err) {
      setError(err);
      setErrors((prev) => ({ ...prev, ...err.fieldErrors?.() }));
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="container" style={{ maxWidth: 560 }}>
      <PageHead title="Create an account">An account lets you request supplies and follow their delivery. It is free.</PageHead>
      <form className="card stack" onSubmit={submit} noValidate>
        {error && <Notice tone="danger" title="Could not create the account">{error.message}</Notice>}
        <Field label="Full name" error={errors.fullName}>
          {(a) => <input {...a} className="input" autoComplete="name" value={form.fullName} onChange={set('fullName')} />}
        </Field>
        <Field label="Email" error={errors.email}>
          {(a) => <input {...a} className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} />}
        </Field>
        <Field label="Phone (optional)" hint="Relief staff may call to confirm your request." error={errors.phone}>
          {(a) => <input {...a} className="input" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />}
        </Field>
        <Field label="Password" hint="At least 10 characters, including a letter and a number." error={errors.password}>
          {(a) => <input {...a} className="input" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
        </Field>
        <p className="small muted" style={{ margin: 0 }}>
          We use your details only to coordinate relief for you. Your exact location is visible only to relief staff handling your request.
        </p>
        <button className="btn btn-primary btn-lg" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
        <p className="small" style={{ margin: 0 }}>
          Already registered? <Link to="/login" state={location.state}>Sign in</Link>
        </p>
      </form>
    </div>
  );
}

function Preferences() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['notification-preferences'], queryFn: notificationsApi.preferences });
  const m = useMutation({
    mutationFn: notificationsApi.updatePreferences,
    onSuccess: (data) => {
      qc.setQueryData(['notification-preferences'], data);
      toast('Notification settings saved');
    },
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const p = q.data;
  return (
    <div className="stack">
      <label className="checkbox">
        <input type="checkbox" checked={p.inApp} onChange={(e) => m.mutate({ inApp: e.target.checked })} />
        <span>
          <strong>In-app notifications</strong>
          <br />
          <span className="small muted">Shown under the bell icon. This is how updates reach you today.</span>
        </span>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={p.email} onChange={(e) => m.mutate({ email: e.target.checked })} />
        <span>
          <strong>Email</strong>
          <br />
          <span className="small muted">Saved as a preference. Email delivery only happens if the server has an email provider configured.</span>
        </span>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={p.sms} onChange={(e) => m.mutate({ sms: e.target.checked })} />
        <span>
          <strong>SMS</strong>
          <br />
          <span className="small muted">Saved as a preference. SMS delivery only happens if the server has an SMS provider configured.</span>
        </span>
      </label>
      <Field label="Only notify me about alerts at or above">
        {(a) => (
          <select {...a} className="input" value={p.minSeverity} onChange={(e) => m.mutate({ minSeverity: e.target.value })}>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY[s].long}
              </option>
            ))}
          </select>
        )}
      </Field>
      {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
    </div>
  );
}

export function ProfilePage() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ fullName: user.fullName, phone: user.phone ?? '' });
  const m = useMutation({
    mutationFn: () => authApi.updateMe({ fullName: form.fullName.trim(), phone: form.phone.trim() || null }),
    onSuccess: (u) => {
      setUser(u);
      toast('Profile updated');
    },
  });
  return (
    <div className="container">
      <PageHead eyebrow={ROLE_LABELS[user.role]} title="Your account" />
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <h2 style={{ fontSize: '1.3rem' }}>Profile</h2>
          <Field label="Full name">{(a) => <input {...a} className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />}</Field>
          <Field label="Phone" hint="Optional">
            {(a) => <input {...a} className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
          </Field>
          <dl className="kv">
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Role</dt>
            <dd>{ROLE_LABELS[user.role]}</dd>
            {user.assignedLocations?.length > 0 && (
              <>
                <dt>Assigned to</dt>
                <dd>{user.assignedLocations.map((l) => l.name).join(', ')}</dd>
              </>
            )}
            {user.teams?.length > 0 && (
              <>
                <dt>Team</dt>
                <dd>{user.teams.map((t) => t.name).join(', ')}</dd>
              </>
            )}
          </dl>
          {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
          <div className="row">
            <button className="btn btn-primary" disabled={m.isPending}>
              Save
            </button>
            <button type="button" className="btn btn-ghost" onClick={logout}>
              Sign out
            </button>
          </div>
        </form>
        <div className="card">
          <h2 style={{ fontSize: '1.3rem' }}>Notifications</h2>
          <Preferences />
        </div>
      </div>
    </div>
  );
}
