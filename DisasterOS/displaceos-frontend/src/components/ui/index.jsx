import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CloudOff, Inbox, Info, Lock, RefreshCw, ShieldAlert } from 'lucide-react';
import { AVAILABILITY, SEVERITY } from '../../lib/format.js';

export function SeverityBadge({ severity, prefix }) {
  if (!severity) return null;
  return (
    <span className={`badge sev-${severity}`}>
      <span className="dot" aria-hidden="true" />
      {prefix ? `${prefix} ` : ''}
      {SEVERITY[severity]?.label ?? severity}
    </span>
  );
}

export function AvailabilityBadge({ status }) {
  return <span className={`badge avail-${status}`}>{AVAILABILITY[status] ?? status}</span>;
}

export function Badge({ children, outline, className = '' }) {
  return <span className={`badge ${outline ? 'badge-outline' : ''} ${className}`}>{children}</span>;
}

export function Loading({ label = 'Loading…', rows }) {
  if (rows) {
    return (
      <div className="stack" aria-busy="true" aria-label={label}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 52 }} />
        ))}
      </div>
    );
  }
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

// Maps API error codes to honest, actionable messages. Never hides a failure behind placeholder data.
export function ErrorState({ error, onRetry, title }) {
  const code = error?.code;
  let Icon = AlertTriangle;
  let heading = title ?? 'This information could not be loaded';
  let body = error?.message ?? 'Something went wrong.';
  let action = null;
  if (code === 'OFFLINE' || code === 'NETWORK' || code === 'SERVER_UNREACHABLE') {
    Icon = CloudOff;
    heading = code === 'OFFLINE' ? 'You are offline' : 'Cannot reach DisplaceOS';
    body = 'Check your connection and try again. Nothing shown here is out of date — it simply has not loaded.';
  } else if (error?.status === 401) {
    Icon = Lock;
    heading = 'Please sign in';
    body = 'Your session has ended or you are not signed in.';
    action = (
      <Link className="btn btn-primary" to="/login">
        Sign in
      </Link>
    );
  } else if (error?.status === 403) {
    Icon = ShieldAlert;
    heading = 'You do not have access to this';
    body = 'Your account role does not allow this action. If you think this is wrong, contact a coordinator.';
  } else if (error?.status === 404) {
    Icon = Inbox;
    heading = 'Not found';
    body = 'This record does not exist, or it is not shared with your account.';
  }
  return (
    <div className="state" role="alert">
      <Icon size={30} aria-hidden="true" />
      <strong>{heading}</strong>
      <span className="small">{body}</span>
      {error?.requestId && <span className="small muted">Reference: {error.requestId}</span>}
      <div className="row">
        {onRetry && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            <RefreshCw size={16} aria-hidden="true" /> Try again
          </button>
        )}
        {action}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, icon: Icon = Inbox, action }) {
  return (
    <div className="state">
      <Icon size={30} aria-hidden="true" />
      <strong>{title}</strong>
      {children && <span className="small">{children}</span>}
      {action}
    </div>
  );
}

// Renders query states uniformly: loading → error → empty → content.
export function QueryState({ query, empty, emptyTitle = 'Nothing here yet', emptyBody, loadingRows, children }) {
  if (query.isPending) return <Loading rows={loadingRows} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (empty?.(query.data)) return <EmptyState title={emptyTitle}>{emptyBody}</EmptyState>;
  return children(query.data);
}

export function Notice({ tone = 'info', icon: Icon = Info, title, children }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon size={20} aria-hidden="true" />
      <div>
        {title && <strong style={{ display: 'block', marginBottom: 2 }}>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, id: givenId }) {
  const autoId = useId();
  const id = givenId ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const child = typeof children === 'function' ? children({ id, 'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined, 'aria-invalid': Boolean(error) }) : children;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
      {child}
      {error && (
        <span className="field-error" id={errId}>
          {error}
        </span>
      )}
    </div>
  );
}

export function Stat({ label, value, note }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? '—'}</div>
      {note && <div className="small muted">{note}</div>}
    </div>
  );
}

// Delivered / on the way / reserved, proportional to the requested amount.
export function QtyBar({ requested, delivered = 0, onTheWay = 0, reserved = 0, label }) {
  const pct = (n) => `${requested > 0 ? Math.min(100, (n / requested) * 100) : 0}%`;
  return (
    <div
      className="qty-bar"
      role="img"
      aria-label={label ?? `${delivered} of ${requested} delivered, ${onTheWay} on the way, ${reserved} reserved`}
    >
      <span className="delivered" style={{ width: pct(delivered) }} />
      <span className="moving" style={{ width: pct(onTheWay) }} />
      <span className="reserved" style={{ width: pct(reserved) }} />
    </div>
  );
}

export function Dialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, textarea, select, button')?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2 style={{ fontSize: '1.35rem' }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// Asks for a reason before a consequential action (cancel, reject, fail, release…).
export function ReasonDialog({ title, description, confirmLabel = 'Confirm', tone = 'primary', onConfirm, onClose, minLength = 3, extra }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (reason.trim().length < minLength) return setError(`Please give a reason (at least ${minLength} characters).`);
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        {description && <p className="muted">{description}</p>}
        {extra}
        <Field label="Reason" error={error}>
          {(a) => <textarea className="input" {...a} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}
        </Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button type="submit" className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function PageHead({ eyebrow, title, children, actions }) {
  return (
    <header className="page-head">
      <div className="row-between" style={{ alignItems: 'flex-end' }}>
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {children && <p className="lead">{children}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
    </header>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
