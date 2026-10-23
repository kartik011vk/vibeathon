// Presentational pieces shared by the signed-in tracking page and the public tracking-link page.
import { Clock, MapPinned, Truck } from 'lucide-react';
import { Badge, QtyBar } from '../../components/ui/index.jsx';
import { DISPATCH_STATUS, distanceLabel, formatDateTime, formatTime, num, timeAgo } from '../../lib/format.js';

const FLOW = [
  { key: 'SUBMITTED', label: 'Request received' },
  { key: 'VERIFIED', label: 'Checked by staff' },
  { key: 'ALLOCATED', label: 'Supplies reserved' },
  { key: 'DISPATCHED', label: 'Team on the way' },
  { key: 'DELIVERED', label: 'Delivered' },
];
const RANK = { SUBMITTED: 0, VERIFIED: 1, ALLOCATED: 2, DISPATCHED: 3, PARTIALLY_DELIVERED: 4, DELIVERED: 4 };

export function StatusStepper({ status }) {
  if (status === 'REJECTED' || status === 'CANCELLED') return null;
  const at = RANK[status] ?? 0;
  return (
    <ol className="steps" aria-label="Request progress">
      {FLOW.map((s, i) => {
        const label = i === 4 && status === 'PARTIALLY_DELIVERED' ? 'Partly delivered' : s.label;
        const state = i < at || (i === at && status === 'DELIVERED') ? 'done' : i === at ? 'current' : '';
        return (
          <li key={s.key} className={state} aria-current={i === at ? 'step' : undefined}>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export function EtaPanel({ eta }) {
  if (!eta) return null;
  if (!eta.etaAvailable) {
    return (
      <div className="notice notice-info">
        <Clock size={20} aria-hidden="true" />
        <div>
          <strong>Arrival time is not available yet</strong>
          {eta.reason && <div className="small">{eta.reason}</div>}
        </div>
      </div>
    );
  }
  const tone = eta.delayStatus === 'ON_TRACK' ? 'notice-info' : 'notice-warn';
  const label = { ON_TRACK: 'Estimated arrival', DELAYED: 'Delayed — new estimated arrival', OVERDUE: 'Later than estimated' }[eta.delayStatus] ?? 'Estimated arrival';
  return (
    <div className={`notice ${tone}`}>
      <Clock size={20} aria-hidden="true" />
      <div>
        <strong>
          {label}: around {formatTime(eta.eta)}
        </strong>
        <div className="small">
          {formatDateTime(eta.eta)}
          {eta.etaUpdatedAt ? ` · estimate updated ${timeAgo(eta.etaUpdatedAt)}` : ''}
          {eta.etaSource === 'MANUAL' ? ' · entered by the response team' : ''}
        </div>
        <div className="small muted">This is an estimate, not a guarantee.{eta.delayStatus === 'OVERDUE' ? ' The team has not yet reported a new time.' : ''}</div>
      </div>
    </div>
  );
}

export function ItemsProgress({ items }) {
  return (
    <div className="stack">
      {items.map((i) => (
        <div key={i.requestItemId ?? i.name}>
          <div className="row-between">
            <strong>{i.name}</strong>
            <span className="small">
              {num(i.delivered)} of {num(i.requested)} {i.unit} delivered · <strong>{num(i.remaining)} remaining</strong>
            </span>
          </div>
          <QtyBar requested={i.requested} delivered={i.delivered} onTheWay={i.onTheWay ?? 0} reserved={i.reservedNotYetDispatched ?? 0} />
        </div>
      ))}
      <div className="legend" aria-hidden="true">
        <span>
          <i className="swatch" style={{ background: 'var(--brown)' }} /> Delivered
        </span>
        {items.some((i) => i.onTheWay != null) && (
          <>
            <span>
              <i className="swatch" style={{ background: 'var(--amber)' }} /> On the way
            </span>
            <span>
              <i className="swatch" style={{ background: 'var(--amber-soft)' }} /> Reserved
            </span>
          </>
        )}
        <span>
          <i className="swatch" style={{ background: 'var(--sand)' }} /> Not yet arranged
        </span>
      </div>
    </div>
  );
}

export function DispatchCard({ d, showExact }) {
  const loc = d.location ?? {};
  return (
    <article className="card card-tight">
      <div className="row-between">
        <div className="row">
          <Truck size={18} aria-hidden="true" />
          <strong>{d.team?.name ?? 'Response team'}</strong>
          <Badge>{DISPATCH_STATUS[d.status] ?? d.status}</Badge>
        </div>
        <span className="small muted">Updated {timeAgo(d.updatedAt)}</span>
      </div>
      {d.source && <div className="small muted">From {d.source.name}</div>}
      <ul className="list small" style={{ marginTop: 8 }}>
        {d.lines?.map((l) => (
          <li key={l.id}>
            {l.item?.name}: {num(l.deliveredQuantity)} of {num(l.quantity)} {l.item?.unit} handed over
          </li>
        ))}
      </ul>
      {['ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'].includes(d.status) && (
        <div className="row small" style={{ marginTop: 8 }}>
          <MapPinned size={16} aria-hidden="true" />
          {loc.available ? (
            <span>
              Team position last reported {timeAgo(loc.updatedAt)}
              {loc.stale && <strong> (out of date)</strong>}
              {loc.approxDistanceToDestinationKm != null && ` · ${distanceLabel(loc.approxDistanceToDestinationKm).replace(' away', ' from the delivery point')}`}
              {showExact && loc.latitude != null && (
                <>
                  {' '}
                  · <span className="code">{loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}</span>
                </>
              )}
            </span>
          ) : (
            <span className="muted">The team has not shared a position.</span>
          )}
        </div>
      )}
      {d.lastHandover && (
        <div className="row small" style={{ marginTop: 8 }}>
          <span className={`badge ${d.lastHandover.locationCheck === 'VERIFIED' ? 'check-ok' : d.lastHandover.locationCheck === 'TOO_FAR' ? 'check-warn' : 'badge-outline'}`}>
            {
              {
                VERIFIED: `✓ Hand-over location verified${d.lastHandover.distanceM != null ? ` (${d.lastHandover.distanceM} m)` : ''}`,
                TOO_FAR: `Handed over ${d.lastHandover.distanceM} m from the delivery point`,
                NO_DESTINATION: 'Hand-over recorded (no delivery pin to compare)',
                NO_LOCATION: 'Hand-over recorded without phone location',
              }[d.lastHandover.locationCheck]
            }
          </span>
          <span className="muted">{timeAgo(d.lastHandover.at)}</span>
        </div>
      )}
      {d.failureReason && <p className="small" style={{ marginTop: 8, marginBottom: 0 }}>Reason: {d.failureReason}</p>}
    </article>
  );
}

export function Timeline({ events }) {
  if (!events?.length) return <p className="muted">No updates yet.</p>;
  const list = [...events].reverse();
  return (
    <ol className="timeline">
      {list.map((e, i) => (
        <li key={e.id ?? `${e.type}-${e.createdAt}`} className={i === 0 ? 'latest' : ''}>
          <strong style={{ display: 'block' }}>{e.message}</strong>
          <span className="small muted">
            {formatDateTime(e.createdAt)}
            {e.actor?.fullName ? ` · ${e.actor.fullName}` : ''}
            {e.isPublic === false ? ' · staff only' : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}
