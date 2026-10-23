import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HandHeart } from 'lucide-react';
import { requestsApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { Badge, EmptyState, ErrorState, Loading, PageHead, SeverityBadge } from '../../components/ui/index.jsx';
import { categoryLabel, CATEGORIES, num, REQUEST_STATUS, SEVERITIES, SEVERITY, timeAgo } from '../../lib/format.js';

const STATUS_FILTERS = [
  { value: 'open', label: 'All open' },
  { value: 'SUBMITTED', label: 'Needs verification' },
  { value: 'VERIFIED', label: 'Needs supplies' },
  { value: 'ALLOCATED', label: 'Needs a team' },
  { value: 'DISPATCHED,PARTIALLY_DELIVERED', label: 'Delivering' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'REJECTED,CANCELLED', label: 'Closed' },
];

export default function RequestsQueuePage() {
  const { user, hasRole } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'open';
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const q = useQuery({
    queryKey: ['requests', 'queue', status, severity, category, search, page],
    queryFn: () =>
      requestsApi.list({
        ...(status === 'open' ? { open: true } : { status }),
        severity: severity || undefined,
        category: category || undefined,
        search: search || undefined,
        sortBy: 'severity',
        sortOrder: 'desc',
        page,
        pageSize: 25,
      }),
    refetchInterval: 45000,
    placeholderData: (prev) => prev,
  });

  const scopeNote = {
    CAMP_MANAGER: 'Requests for your assigned camps.',
    INVENTORY_MANAGER: 'Requests that draw stock from your locations.',
    RESPONSE_TEAM: 'Requests your team is delivering.',
  }[user.role];

  return (
    <div>
      <PageHead
        eyebrow="Operations"
        title="Requests"
        actions={
          hasRole('CAMP_MANAGER', 'RELIEF_COORDINATOR', 'ADMIN') && (
            <Link to="/request" className="btn btn-primary">
              <HandHeart size={16} /> New request
            </Link>
          )
        }
      >
        {scopeNote ?? 'Highest priority first, then oldest.'}
      </PageHead>
      <div className="stack">
        <div className="row" role="group" aria-label="Filter by state">
          {STATUS_FILTERS.map((f) => (
            <button key={f.value} type="button" className={`btn btn-sm ${status === f.value ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={status === f.value} onClick={() => (setParams({ status: f.value }), setPage(1))}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="row">
          <select className="input" style={{ width: 'auto' }} aria-label="Priority" value={severity} onChange={(e) => (setSeverity(e.target.value), setPage(1))}>
            <option value="">Any priority</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY[s].label}
              </option>
            ))}
          </select>
          <select className="input" style={{ width: 'auto' }} aria-label="Category" value={category} onChange={(e) => (setCategory(e.target.value), setPage(1))}>
            <option value="">Any supply</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <input className="input" style={{ width: 240 }} aria-label="Search reference or description" placeholder="Search reference or text" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} />
        </div>

        {q.isPending && <Loading rows={5} />}
        {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
        {q.data && q.data.data.length === 0 && <EmptyState title="No requests match these filters" />}
        {q.data && q.data.data.length > 0 && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Need</th>
                    <th scope="col">Priority</th>
                    <th scope="col">State</th>
                    <th scope="col" className="num">People</th>
                    <th scope="col">Where</th>
                    <th scope="col">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.data.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/requests/${r.id}`} className="code">
                          {r.referenceCode}
                        </Link>
                      </td>
                      <td>
                        {categoryLabel(r.category)}
                        <div className="small muted">{r.items.map((i) => `${i.quantity} ${i.unit}`).join(', ')}</div>
                      </td>
                      <td>
                        <SeverityBadge severity={r.severity} />
                        {r.suggestedSeverity !== r.severity && r.verified && <div className="small muted">Rules: {SEVERITY[r.suggestedSeverity].label}</div>}
                      </td>
                      <td>
                        <Badge>{REQUEST_STATUS[r.status]}</Badge>
                      </td>
                      <td className="num">{num(r.peopleAffected)}</td>
                      <td className="small">{r.camp?.name ?? r.destinationAddress ?? (r.latitude != null ? 'Pinned location' : '—')}</td>
                      <td className="small">{timeAgo(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-between">
              <span className="small muted">
                Page {q.data.meta.page} of {q.data.meta.totalPages} · {q.data.meta.total} requests
              </span>
              <div className="row">
                <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={page >= q.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
