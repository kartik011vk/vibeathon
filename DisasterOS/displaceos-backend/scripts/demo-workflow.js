// Runs the documented demo sequence (docs/demo-workflow.md) against a running, seeded API and prints evidence.
//   npm run demo:workflow                       # http://localhost:4000/api/v1
//   DEMO_API_URL=http://host:port/api/v1 npm run demo:workflow
// It creates new records (a request, allocation, dispatch, deliveries) in the target database.
const API = process.env.DEMO_API_URL ?? 'http://localhost:4000/api/v1';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoPass2026!';

async function call(method, path, { token, body, expect = [200, 201] } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!expect.includes(res.status)) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json.error ?? json)}`);
  }
  return { status: res.status, ...json };
}

const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: PASSWORD } })).data.accessToken;
const step = (n, text) => console.log(`\n${n}. ${text}`);
const show = (label, value) => console.log(`   ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);

step(1, 'API health');
show('health', (await call('GET', '/health')).data);

step(2, 'Seed data present');
const camps = (await call('GET', '/locations?type=CAMP')).data;
const camp = camps.find((c) => c.name.startsWith('Raipur')) ?? camps[0];
show('camp', camp.name);

step(3, 'Citizen creates a request');
const citizen = await login('citizen@displaceos.dev');
const catalogue = (await call('GET', '/inventory?category=WATER', { token: citizen })).data;
const water = catalogue.find((i) => i.name.startsWith('Drinking water'));
const created = await call('POST', '/requests', {
  token: citizen,
  body: { category: 'WATER', description: 'Demo: water needed for a family block at the camp', peopleAffected: 30, vulnerableCount: 6, campId: camp.id, items: [{ inventoryItemId: water.id, quantity: 12 }] },
});
const req = created.data;
show('request', `${req.referenceCode} status=${req.status} severity=${req.severity} (server-suggested)`);

step(4, 'Coordinator verifies; inspect alert and timeline');
const coord = await login('coordinator@displaceos.dev');
await call('POST', `/requests/${req.id}/verify`, { token: coord, body: { decision: 'VERIFY', reason: 'Confirmed with camp help desk (demo run)' } });
const alerts = (await call('GET', `/alerts?requestId=${req.id}`, { token: coord })).data;
show('alerts for request', alerts.map((a) => `${a.severity} ${a.status} source=${a.source}`));
const timeline = (await call('GET', `/requests/${req.id}/timeline`, { token: coord })).data;
show('timeline', timeline.map((t) => t.type));

step(5, 'Inventory manager checks and adds stock');
const inv = await login('inventory@displaceos.dev');
const avail = (await call('GET', `/inventory/availability?itemId=${water.id}`)).data;
show('availability', avail.map((a) => `${a.location.name}: ${a.available ?? 'not confirmed'} (${a.availabilityStatus})`));
const warehouse = avail.find((a) => a.location.type === 'WAREHOUSE').location;
const receipt = (await call('POST', '/inventory/transactions', { token: inv, body: { type: 'RECEIPT', itemId: water.id, locationId: warehouse.id, quantity: 20, reason: 'Tanker delivery (demo run)' } })).data;
show('receipt', `onHandAfter=${receipt.onHandAfter} reservedAfter=${receipt.reservedAfter}`);

step(6, 'Allocation: suggestions → propose → approve (duplicate approval refused)');
const sug = (await call('GET', `/allocations/suggestions?requestId=${req.id}`, { token: coord })).data;
show('top suggestion', `${sug.candidates[0].location.name} — ${sug.candidates[0].rationale.join('; ')}`);
const alloc = (await call('POST', '/allocations', {
  token: coord,
  body: { requestId: req.id, sourceLocationId: sug.candidates[0].location.id, lines: sug.candidates[0].lines.map((l) => ({ requestItemId: l.requestItemId, quantity: l.proposedQuantity })) },
})).data;
await call('POST', `/allocations/${alloc.id}/approve`, { token: coord });
const dup = await call('POST', `/allocations/${alloc.id}/approve`, { token: coord, expect: [409] });
show('approve again', `${dup.status} ${dup.error.code}`);

step(7, 'Dispatch to a response team');
const teams = (await call('GET', '/teams', { token: coord })).data;
const bravo = teams.find((t) => t.name.startsWith('Team Bravo')) ?? teams[0];
const dispatch = (await call('POST', '/dispatches', { token: coord, body: { allocationId: alloc.id, teamId: bravo.id, notes: 'Demo run' } })).data;
show('dispatch', `${dispatch.id} status=${dispatch.status} team=${bravo.name}`);

step(8, 'Team accepts, starts, records manual ETA and location');
const team = await login('team.bravo@displaceos.dev');
await call('POST', `/dispatches/${dispatch.id}/accept`, { token: team });
await call('POST', `/dispatches/${dispatch.id}/start`, { token: team });
await call('POST', `/dispatches/${dispatch.id}/eta`, { token: team, body: { eta: new Date(Date.now() + 45 * 60000).toISOString(), reason: 'Driver estimate (demo run)' } });
await call('PATCH', `/dispatches/${dispatch.id}/location`, { token: team, body: { latitude: 30.25, longitude: 78.15 } });
show('status', 'IN_TRANSIT with ETA and position');

step(9, 'Requester tracking and ETA history');
const track = (await call('GET', `/requests/${req.id}/tracking`, { token: citizen })).data;
show('tracking', { status: track.request.statusLabel, eta: track.eta, teamPositionVisible: track.dispatches[0].location.latitude !== undefined, approxKm: track.dispatches[0].location.approxDistanceToDestinationKm });
const dTrack = (await call('GET', `/dispatches/${dispatch.id}/tracking`, { token: coord })).data;
show('etaHistory', dTrack.etaHistory.map((h) => `${h.source} ${h.newEta ?? 'unavailable'} — ${h.reason}`));

step(10, 'Partial delivery, then completion');
const line = dTrack.lines[0];
const half = Math.max(1, Math.floor(line.quantity / 2));
const p1 = (await call('POST', `/dispatches/${dispatch.id}/complete`, { token: team, body: { lines: [{ dispatchLineId: line.id, quantity: half }], notes: 'First drop' } })).data;
show('after partial', `${p1.status} delivered=${p1.lines[0].deliveredQuantity}/${p1.lines[0].quantity}`);
const p2 = (await call('POST', `/dispatches/${dispatch.id}/complete`, { token: team, body: { lines: [{ dispatchLineId: line.id, quantity: line.quantity - half }] } })).data;
show('after completion', `${p2.status} delivered=${p2.lines[0].deliveredQuantity}/${p2.lines[0].quantity}`);
const finalTrack = (await call('GET', `/requests/${req.id}/tracking`, { token: citizen })).data;
show('request', `${finalTrack.request.statusLabel}; totals=${JSON.stringify(finalTrack.totals)}`);

step(11, 'Notifications, audit log and dashboard');
const notes = await call('GET', '/notifications?pageSize=50', { token: citizen });
show('citizen notifications', `${notes.meta.total} total, ${notes.meta.unread} unread; latest: ${notes.data[0]?.title}`);
const admin = await login('admin@displaceos.dev');
const audit = await call('GET', `/audit-logs?entityId=${dispatch.id}&pageSize=50`, { token: admin });
show('audit (dispatch)', audit.data.map((a) => a.action));
const dash = (await call('GET', '/dashboard/summary', { token: coord })).data;
show('dashboard requests.byStatus', dash.requests.byStatus);

step(12, 'Automated tests');
show('run', 'npm test');
console.log('\nDemo workflow completed.');
