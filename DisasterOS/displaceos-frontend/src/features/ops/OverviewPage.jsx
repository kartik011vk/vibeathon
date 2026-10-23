import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { EmptyState, ErrorState, Loading, PageHead, SeverityBadge, Stat } from '../../components/ui/index.jsx';
import { categoryLabel, minutesLabel, num, REQUEST_STATUS } from '../../lib/format.js';

function CriticalNeeds() {
  const q = useQuery({ queryKey: ['dashboard', 'critical'], queryFn: dashboardApi.criticalNeeds, refetchInterval: 60000 });
  if (q.isPending) return <Loading rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data.length) return <EmptyState title="No open high-priority requests">Requests marked High, Critical or Highest priority will appear here.</EmptyState>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Request</th>
            <th scope="col">Priority</th>
            <th scope="col">State</th>
            <th scope="col" className="num">
              People
            </th>
            <th scope="col" className="num">
              Units still needed
            </th>
            <th scope="col">Waiting</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((r) => (
            <tr key={r.id}>
              <td>
                <Link to={`/requests/${r.id}`} className="code">
                  {r.referenceCode}
                </Link>
                <div className="small muted">
                  {categoryLabel(r.category)}
                  {r.camp ? ` · ${r.camp}` : ''}
                </div>
              </td>
              <td>
                <SeverityBadge severity={r.severity} />
              </td>
              <td className="small">{REQUEST_STATUS[r.status]}</td>
              <td className="num">
                {num(r.peopleAffected)}
                {r.vulnerableCount ? <div className="small muted">{r.vulnerableCount} vulnerable</div> : null}
              </td>
              <td className="num">{num(r.remainingUnits)}</td>
              <td className="small">{minutesLabel(r.waitingMinutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoordinatorStats() {
  const s = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: dashboardApi.summary, refetchInterval: 60000 });
  const rt = useQuery({ queryKey: ['dashboard', 'response-times'], queryFn: () => dashboardApi.responseTimes(30) });
  const dist = useQuery({ queryKey: ['dashboard', 'distribution'], queryFn: dashboardApi.resourceDistribution });
  return (
    <>
      {s.isPending && <Loading rows={2} />}
      {s.isError && <ErrorState error={s.error} onRetry={s.refetch} />}
      {s.data && (
        <div className="grid grid-4">
          <Stat label="Open requests" value={num(s.data.requests.open)} note={`${num(s.data.requests.peopleAffectedOpen)} people affected`} />
          <Stat label="Waiting for verification" value={num(s.data.requests.awaitingVerification)} />
          <Stat label="Open critical alerts" value={num(s.data.alerts.openBySeverity.RED + s.data.alerts.openBySeverity.HYPER_RED)} note={`${s.data.alerts.openBySeverity.HIGH} high attention`} />
          <Stat label="Deliveries under way" value={num(s.data.dispatches.ASSIGNED + s.data.dispatches.ACCEPTED + s.data.dispatches.IN_TRANSIT + s.data.dispatches.PARTIALLY_DELIVERED)} note={`${s.data.teams.AVAILABLE} teams available`} />
          <Stat label="Delivered" value={num(s.data.requests.byStatus.DELIVERED)} note={`${s.data.requests.byStatus.PARTIALLY_DELIVERED} partly delivered`} />
          <Stat label="Low-stock lines" value={num(s.data.inventory.lowStockLines)} note={`of ${s.data.inventory.stockLines} stock lines`} />
        </div>
      )}

      <section className="card" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: '1.2rem' }}>Response times (last 30 days)</h2>
        {rt.isPending && <Loading rows={1} />}
        {rt.isError && <ErrorState error={rt.error} />}
        {rt.data && (
          <div className="grid grid-3">
            {[
              ['Received → verified', rt.data.submittedToVerified],
              ['Verified → team assigned', rt.data.verifiedToDispatched],
              ['On the road → delivered', rt.data.transitToDelivered],
            ].map(([label, m]) => (
              <Stat key={label} label={label} value={minutesLabel(m.medianMinutes)} note={m.samples ? `median of ${m.samples} · average ${minutesLabel(m.averageMinutes)}` : 'No completed samples yet'} />
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: '1.2rem' }}>Supplies by category</h2>
        {dist.isPending && <Loading rows={2} />}
        {dist.isError && <ErrorState error={dist.error} />}
        {dist.data && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col" className="num">On hand</th>
                    <th scope="col" className="num">Reserved</th>
                    <th scope="col" className="num">Available</th>
                    <th scope="col" className="num">Requested (all time)</th>
                    <th scope="col" className="num">Delivered</th>
                  </tr>
                </thead>
                <tbody>
                  {dist.data.byCategory.map((c) => (
                    <tr key={c.category}>
                      <td>{categoryLabel(c.category)}</td>
                      <td className="num">{num(c.onHand)}</td>
                      <td className="num">{num(c.reserved)}</td>
                      <td className="num">{num(c.available)}</td>
                      <td className="num">{num(c.requested)}</td>
                      <td className="num">{num(c.delivered)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>
              {dist.data.note}
            </p>
          </>
        )}
      </section>
    </>
  );
}

export default function OverviewPage() {
  const { hasRole } = useAuth();
  const coordinator = hasRole('RELIEF_COORDINATOR', 'ADMIN');
  return (
    <div>
      <PageHead eyebrow="Operations" title={coordinator ? 'Coordination overview' : 'Camp overview'}>
        {coordinator ? 'All figures are counted from the database when this page loads.' : 'High-priority requests from your assigned camps.'}
      </PageHead>
      <div className="stack-lg">
        {coordinator && <CoordinatorStats />}
        <section>
          <div className="row-between">
            <h2 style={{ fontSize: '1.3rem' }}>Critical needs</h2>
            <Link to="/ops/requests?status=SUBMITTED" className="small">
              Verification queue →
            </Link>
          </div>
          <CriticalNeeds />
        </section>
      </div>
    </div>
  );
}
