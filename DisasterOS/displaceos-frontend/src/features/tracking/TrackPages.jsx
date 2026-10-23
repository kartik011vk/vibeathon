import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HandHeart, Link2, Search } from 'lucide-react';
import { requestsApi, trackingApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { EmptyState, ErrorState, Field, Loading, Notice, PageHead, SeverityBadge, Badge } from '../../components/ui/index.jsx';
import { categoryLabel, formatDateTime, REQUEST_STATUS, timeAgo } from '../../lib/format.js';
import { EtaPanel, ItemsProgress, StatusStepper, Timeline } from './TrackingParts.jsx';

function extractToken(input) {
  const v = input.trim();
  const m = v.match(/track\/([A-Za-z0-9_-]{30,100})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{30,100}$/.test(v) ? v : null;
}

function LinkLookup() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        const token = extractToken(value);
        if (!token) return setError('That does not look like a DisplaceOS tracking link.');
        navigate(`/track/${token}`);
      }}
    >
      <h2 style={{ fontSize: '1.2rem' }}>
        <Link2 size={18} aria-hidden="true" /> Have a tracking link?
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        Someone can share a private link to follow a request without signing in. Paste it here.
      </p>
      <Field label="Tracking link" error={error}>
        {(a) => <input {...a} className="input" value={value} onChange={(e) => (setValue(e.target.value), setError(null))} placeholder="https://…/track/…" />}
      </Field>
      <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }}>
        Open tracking
      </button>
    </form>
  );
}

function MyRequests() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['requests', 'mine', search],
    queryFn: () => requestsApi.list({ mine: true, search: search || undefined, pageSize: 50 }),
    refetchInterval: 60000,
  });
  return (
    <div className="stack">
      <div className="row-between">
        <h2 style={{ margin: 0 }}>Your requests</h2>
        <div className="row">
          <label className="visually-hidden" htmlFor="ref-search">
            Search by reference
          </label>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 15 }} aria-hidden="true" />
            <input id="ref-search" className="input" style={{ paddingLeft: 34, width: 220 }} placeholder="Reference e.g. DR-7K3F9Q" value={search} onChange={(e) => setSearch(e.target.value.toUpperCase())} />
          </div>
        </div>
      </div>
      {q.isPending && <Loading rows={3} />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && q.data.data.length === 0 && (
        <EmptyState
          title={search ? 'No request matches that reference' : 'You have not made any requests yet'}
          action={
            !search && (
              <Link to="/request" className="btn btn-primary">
                <HandHeart size={16} /> Request supplies
              </Link>
            )
          }
        >
          {search ? 'Check the reference and try again. Only requests made from your account are shown.' : null}
        </EmptyState>
      )}
      {q.data?.data.map((r) => (
        <Link key={r.id} to={`/requests/${r.id}`} className="card card-tight" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="row-between">
            <div>
              <span className="code">{r.referenceCode}</span> <strong>{categoryLabel(r.category)}</strong>
              <div className="small muted">
                Sent {formatDateTime(r.createdAt)} · {r.items.reduce((s, i) => s + i.remainingQuantity, 0)} units still to arrive
              </div>
            </div>
            <div className="row">
              {user.role !== 'CITIZEN' && <SeverityBadge severity={r.severity} />}
              <Badge>{REQUEST_STATUS[r.status]}</Badge>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function TrackPage() {
  const { status, user } = useAuth();
  return (
    <div className="container">
      <PageHead eyebrow="Track my request" title="Where are my supplies?">
        Follow each step from the moment your request is received until the last item is handed over.
      </PageHead>
      <div className="grid grid-2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
        <div>
          {status === 'loading' && <Loading />}
          {status === 'anonymous' && (
            <div className="card stack">
              <h2 style={{ fontSize: '1.3rem' }}>Sign in to see your requests</h2>
              <p className="muted">Your requests are linked to your account so only you and relief staff can see them.</p>
              <div className="row">
                <Link to="/login" state={{ from: '/track' }} className="btn btn-primary">
                  Sign in
                </Link>
                <Link to="/register" state={{ from: '/track' }} className="btn btn-secondary">
                  Create account
                </Link>
              </div>
            </div>
          )}
          {status === 'authenticated' && (user.role === 'CITIZEN' || user.role === 'CAMP_MANAGER' ? <MyRequests /> : (
            <div className="card">
              <p>Staff can open any request in their scope from the operations area.</p>
              <Link to="/ops" className="btn btn-primary">
                Open operations
              </Link>
            </div>
          ))}
        </div>
        <LinkLookup />
      </div>
    </div>
  );
}

export function PublicTrackingPage() {
  const { token } = useParams();
  const q = useQuery({ queryKey: ['tracking', 'public', token], queryFn: () => trackingApi.publicByToken(token), refetchInterval: 60000, retry: false });
  return (
    <div className="container" style={{ maxWidth: 820 }}>
      <PageHead eyebrow="Shared tracking link" title="Delivery tracking" />
      {q.isPending && <Loading />}
      {q.isError &&
        (q.error.status === 404 ? (
          <EmptyState title="This tracking link is not valid">It may have expired or been turned off by the person who shared it.</EmptyState>
        ) : (
          <ErrorState error={q.error} onRetry={q.refetch} />
        ))}
      {q.data && (
        <div className="stack-lg">
          <div className="card stack">
            <div className="row-between">
              <div>
                <span className="ref-code">{q.data.referenceCode}</span>
                <div className="muted">{categoryLabel(q.data.category)}</div>
              </div>
              <Badge>{q.data.statusLabel}</Badge>
            </div>
            <StatusStepper status={q.data.status} />
            <EtaPanel eta={q.data.eta} />
            <ItemsProgress items={q.data.items} />
            <p className="small muted" style={{ margin: 0 }}>
              Last updated {timeAgo(q.data.lastUpdatedAt)} · This link stops working on {formatDateTime(q.data.linkExpiresAt)}.
            </p>
          </div>
          <div className="card">
            <h2 style={{ fontSize: '1.2rem' }}>Updates</h2>
            <Timeline events={q.data.timeline} />
          </div>
          <Notice>{q.data.disclaimer}</Notice>
        </div>
      )}
    </div>
  );
}
