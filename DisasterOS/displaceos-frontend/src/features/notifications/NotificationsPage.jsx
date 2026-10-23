import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../../api/services.js';
import { EmptyState, ErrorState, Loading, PageHead } from '../../components/ui/index.jsx';
import { formatDateTime, timeAgo } from '../../lib/format.js';

function linkFor(n) {
  if (n.data?.requestId) return `/requests/${n.data.requestId}`;
  if (n.data?.dispatchId) return '/ops/dispatch';
  if (n.data?.alertId) return '/ops/alerts';
  return null;
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const q = useQuery({ queryKey: ['notifications', 'list', unreadOnly], queryFn: () => notificationsApi.list({ pageSize: 50, unreadOnly: unreadOnly || undefined }), refetchInterval: 60000 });
  const read = useMutation({ mutationFn: notificationsApi.markRead, onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  return (
    <div className="container" style={{ maxWidth: 820 }}>
      <PageHead
        title="Notifications"
        actions={
          <label className="checkbox">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only
          </label>
        }
      >
        <Link to="/profile">Notification settings</Link>
      </PageHead>
      {q.isPending && <Loading rows={4} />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && q.data.data.length === 0 && <EmptyState title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}>Updates about your requests and work appear here.</EmptyState>}
      <ul className="list">
        {q.data?.data.map((n) => {
          const to = linkFor(n);
          return (
            <li key={n.id} className="list-item" style={{ opacity: n.readAt ? 0.7 : 1 }}>
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div>
                  <strong>
                    {!n.readAt && <span className="dot" style={{ color: 'var(--orange-strong)', marginRight: 8 }} aria-label="Unread" />}
                    {n.title}
                  </strong>
                  <p style={{ margin: '2px 0' }}>{n.body}</p>
                  <span className="small muted" title={formatDateTime(n.createdAt)}>
                    {timeAgo(n.createdAt)}
                  </span>
                </div>
                <div className="row">
                  {to && (
                    <Link to={to} className="btn btn-secondary btn-sm" onClick={() => !n.readAt && read.mutate(n.id)}>
                      Open
                    </Link>
                  )}
                  {!n.readAt && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => read.mutate(n.id)}>
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
