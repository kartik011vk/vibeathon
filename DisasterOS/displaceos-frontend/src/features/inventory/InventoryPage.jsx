import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, PackagePlus, Plus } from 'lucide-react';
import { allocationsApi, inventoryApi } from '../../api/services.js';
import { useAuth } from '../../app/AuthContext.jsx';
import { useToast } from '../../app/Toast.jsx';
import { Badge, Dialog, EmptyState, ErrorState, Field, Loading, Notice, PageHead, Tabs } from '../../components/ui/index.jsx';
import { CATEGORIES, categoryLabel, formatDateTime, LOCATION_TYPES, num, timeAgo } from '../../lib/format.js';

const TXN_LABEL = { RECEIPT: 'Received', ADJUSTMENT: 'Count adjustment', RESERVATION: 'Reserved', RELEASE: 'Released', CONSUMPTION: 'Handed out' };

function TransactionForm({ items, locations, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ type: 'RECEIPT', itemId: '', locationId: locations[0]?.id ?? '', quantity: '', reason: '' });
  const m = useMutation({
    mutationFn: () => inventoryApi.recordTransaction({ ...form, quantity: Number(form.quantity), reason: form.reason.trim() }),
    onSuccess: () => {
      toast('Stock updated');
      qc.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    },
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const qtyOk = form.type === 'ADJUSTMENT' ? Number(form.quantity) !== 0 && Number.isInteger(Number(form.quantity)) : Number(form.quantity) > 0 && Number.isInteger(Number(form.quantity));
  return (
    <Dialog title="Record a stock change" onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
        <Field label="Type of change">
          {(a) => (
            <select {...a} className="input" value={form.type} onChange={set('type')}>
              <option value="RECEIPT">Received new stock</option>
              <option value="ADJUSTMENT">Correct after a physical count (+ or −)</option>
              <option value="CONSUMPTION">Handed out directly at this location</option>
            </select>
          )}
        </Field>
        <Field label="Location">
          {(a) => (
            <select {...a} className="input" value={form.locationId} onChange={set('locationId')}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Item">
          {(a) => (
            <select {...a} className="input" value={form.itemId} onChange={set('itemId')}>
              <option value="">Choose…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Quantity" hint={form.type === 'ADJUSTMENT' ? 'Use a negative number to reduce. Stock reserved for approved allocations cannot be adjusted away.' : 'Whole units only.'}>
          {(a) => <input {...a} className="input" type="number" step="1" value={form.quantity} onChange={set('quantity')} />}
        </Field>
        <Field label="Reason or reference" hint="For example: delivery note number, count sheet, distribution list.">
          {(a) => <input {...a} className="input" maxLength={500} value={form.reason} onChange={set('reason')} />}
        </Field>
        {m.isError && <Notice tone="danger">{m.error.code === 'INSUFFICIENT_STOCK' ? 'Not enough unreserved stock for this change.' : m.error.message}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button className="btn btn-primary" disabled={m.isPending || !form.itemId || !form.locationId || !qtyOk || form.reason.trim().length < 3}>
            Save change
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function NewItemForm({ onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ sku: '', name: '', category: 'FOOD', unit: '', lowStockThreshold: 0 });
  const m = useMutation({
    mutationFn: () => inventoryApi.createItem({ ...form, sku: form.sku.trim().toUpperCase(), name: form.name.trim(), unit: form.unit.trim(), lowStockThreshold: Number(form.lowStockThreshold) }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['inventory'] }), onClose()),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <Dialog title="Add a catalogue item" onClose={onClose}>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), m.mutate())}>
        <div className="grid grid-2">
          <Field label="SKU" hint="Uppercase letters, digits, dashes">{(a) => <input {...a} className="input" value={form.sku} onChange={set('sku')} />}</Field>
          <Field label="Category">
            {(a) => (
              <select {...a} className="input" value={form.category} onChange={set('category')}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field label="Name">{(a) => <input {...a} className="input" value={form.name} onChange={set('name')} />}</Field>
        <div className="grid grid-2">
          <Field label="Unit" hint="e.g. kits, litres, packs">{(a) => <input {...a} className="input" value={form.unit} onChange={set('unit')} />}</Field>
          <Field label="Low-stock level">{(a) => <input {...a} className="input" type="number" min="0" value={form.lowStockThreshold} onChange={set('lowStockThreshold')} />}</Field>
        </div>
        {m.isError && <Notice tone="danger">{m.error.message}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button className="btn btn-primary" disabled={m.isPending}>
            Add item
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function PendingApprovals() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['allocations', 'pending'], queryFn: () => allocationsApi.list({ status: 'PROPOSED', pageSize: 50 }) });
  const approve = useMutation({
    mutationFn: allocationsApi.approve,
    onSuccess: () => (toast('Stock reserved'), qc.invalidateQueries({ queryKey: ['allocations'] }), qc.invalidateQueries({ queryKey: ['inventory'] })),
  });
  if (q.isPending) return <Loading rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const mine = q.data.data.filter((a) => user.role !== 'INVENTORY_MANAGER' || user.assignedLocations.some((l) => l.id === a.sourceLocation.id));
  if (!mine.length) return <EmptyState title="No allocations waiting for approval" />;
  return (
    <div className="stack">
      {mine.map((a) => (
        <div key={a.id} className="card card-tight row-between">
          <div>
            <strong>{a.sourceLocation.name}</strong> → request <span className="code">{a.request.referenceCode}</span>
            <div className="small muted">
              {a.lines.map((l) => `${l.quantity} ${l.item.unit} ${l.item.name}`).join(' · ')} · proposed by {a.proposedBy.fullName} {timeAgo(a.createdAt)}
            </div>
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={approve.isPending} onClick={() => approve.mutate(a.id)}>
            Approve and reserve
          </button>
        </div>
      ))}
      {approve.isError && <Notice tone="danger">{approve.error.code === 'INSUFFICIENT_STOCK' ? 'There is no longer enough unreserved stock for that allocation.' : approve.error.message}</Notice>}
    </div>
  );
}

export default function InventoryPage() {
  const { user, hasRole } = useAuth();
  const [tab, setTab] = useState('stock');
  const [dialog, setDialog] = useState(null);
  const [locationFilter, setLocationFilter] = useState('');
  const canWrite = hasRole('INVENTORY_MANAGER', 'ADMIN');

  const locations = useQuery({ queryKey: ['inventory', 'locations'], queryFn: inventoryApi.locations });
  const items = useQuery({ queryKey: ['inventory', 'items'], queryFn: () => inventoryApi.catalogue({ pageSize: 100 }) });
  const low = useQuery({ queryKey: ['inventory', 'low'], queryFn: inventoryApi.lowStock });
  const ledger = useQuery({ queryKey: ['inventory', 'ledger', locationFilter], queryFn: () => inventoryApi.transactions({ pageSize: 50, locationId: locationFilter || undefined }), enabled: tab === 'ledger' });

  const manageable = useMemo(() => (locations.data ?? []).filter((l) => user.role === 'ADMIN' || l.assignedToMe), [locations.data, user.role]);
  const rows = useMemo(() => {
    const out = [];
    for (const i of items.data?.data ?? []) for (const b of i.balances ?? []) if (!locationFilter || b.locationId === locationFilter) out.push({ item: i, b });
    return out.sort((a, z) => a.b.location.name.localeCompare(z.b.location.name) || a.item.name.localeCompare(z.item.name));
  }, [items.data, locationFilter]);

  return (
    <div>
      <PageHead
        eyebrow="Operations"
        title="Inventory"
        actions={
          canWrite && (
            <>
              {hasRole('INVENTORY_MANAGER', 'ADMIN') && (
                <button type="button" className="btn btn-secondary" onClick={() => setDialog('item')}>
                  <Plus size={16} /> New item
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => setDialog('txn')} disabled={!manageable.length || !items.data}>
                <PackagePlus size={16} /> Record stock change
              </button>
            </>
          )
        }
      >
        Available = on hand − reserved. Reservations are made only by approved allocations, so the same stock cannot be promised twice.
      </PageHead>

      {low.data?.length > 0 && (
        <Notice tone="warn" icon={AlertTriangle} title={`${low.data.length} stock line${low.data.length > 1 ? 's are' : ' is'} at or below the low-stock level`}>
          {low.data
            .slice(0, 4)
            .map((l) => `${l.item.name} at ${l.location.name} (${l.available} ${l.item.unit})`)
            .join(' · ')}
          {low.data.length > 4 ? ' …' : ''}
        </Notice>
      )}

      <div className="grid grid-3" style={{ margin: '20px 0' }}>
        {locations.isPending && <Loading rows={2} />}
        {locations.isError && <ErrorState error={locations.error} onRetry={locations.refetch} />}
        {locations.data?.map((l) => (
          <button
            key={l.id}
            type="button"
            className="choice"
            aria-pressed={locationFilter === l.id}
            onClick={() => setLocationFilter((v) => (v === l.id ? '' : l.id))}
          >
            <div className="row-between" style={{ width: '100%' }}>
              <strong>{l.name}</strong>
              {l.assignedToMe && <Badge className="sev-HIGH">Yours</Badge>}
            </div>
            <span className="small muted">
              {LOCATION_TYPES[l.type]} · {l.itemCount} items
            </span>
            <span className="small">
              {num(l.totals.available)} available · {num(l.totals.reserved)} reserved
              {l.lowStockCount ? ` · ${l.lowStockCount} low` : ''}
            </span>
          </button>
        ))}
      </div>

      <Tabs
        label="Inventory views"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'stock', label: 'Stock levels' },
          { value: 'approvals', label: 'Waiting for approval' },
          { value: 'ledger', label: 'Transaction ledger' },
        ]}
      />

      {tab === 'stock' && (
        <>
          {items.isPending && <Loading rows={4} />}
          {items.isError && <ErrorState error={items.error} onRetry={items.refetch} />}
          {items.data && rows.length === 0 && <EmptyState title="No stock recorded here yet" />}
          {rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Location</th>
                    <th scope="col">Item</th>
                    <th scope="col" className="num">On hand</th>
                    <th scope="col" className="num">Reserved</th>
                    <th scope="col" className="num">Available</th>
                    <th scope="col">Last counted</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ item, b }) => (
                    <tr key={`${item.id}-${b.locationId}`}>
                      <td className="small">{b.location.name}</td>
                      <td>
                        {item.name}
                        <div className="small muted">{categoryLabel(item.category)}</div>
                      </td>
                      <td className="num">{num(b.onHand)}</td>
                      <td className="num">{num(b.reserved)}</td>
                      <td className="num">
                        <strong>{num(b.available)}</strong> {item.unit}
                        {b.available <= item.lowStockThreshold && <div className="small" style={{ color: 'var(--sev-red-fg)' }}>low</div>}
                      </td>
                      <td className="small">{b.lastCountedAt ? timeAgo(b.lastCountedAt) : 'never'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'approvals' && <PendingApprovals />}

      {tab === 'ledger' && (
        <>
          {ledger.isPending && <Loading rows={4} />}
          {ledger.isError && <ErrorState error={ledger.error} onRetry={ledger.refetch} />}
          {ledger.data && ledger.data.data.length === 0 && <EmptyState title="No transactions yet" />}
          {ledger.data?.data.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Change</th>
                    <th scope="col">Item · location</th>
                    <th scope="col" className="num">Quantity</th>
                    <th scope="col" className="num">On hand / reserved after</th>
                    <th scope="col">By · reason</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.data.map((t) => (
                    <tr key={t.id}>
                      <td className="small">{formatDateTime(t.createdAt)}</td>
                      <td>
                        <Badge>{TXN_LABEL[t.type]}</Badge>
                      </td>
                      <td className="small">
                        {t.item.name}
                        <div className="muted">{t.location.name}</div>
                      </td>
                      <td className="num">
                        {t.quantity > 0 ? '+' : ''}
                        {num(t.quantity)}
                      </td>
                      <td className="num small">
                        {num(t.onHandAfter)} / {num(t.reservedAfter)}
                      </td>
                      <td className="small">
                        {t.actor?.fullName ?? 'System'}
                        <div className="muted">{t.reason}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {dialog === 'txn' && items.data && <TransactionForm items={items.data.data} locations={manageable} onClose={() => setDialog(null)} />}
      {dialog === 'item' && <NewItemForm onClose={() => setDialog(null)} />}
    </div>
  );
}
