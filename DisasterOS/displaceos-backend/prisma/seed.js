// DEVELOPMENT-ONLY demo seed. Every record is labelled "(demo)" and does not describe a real event.
// Coordinates are approximate positions of real towns around Dehradun, used only so maps render.
// The shared password below is for local development; never use these accounts in production.
//
// The seed drives the real service layer, so timelines, alerts, reservations and audit entries are consistent.
import { prisma } from '../src/utils/prisma.js';
import { config } from '../src/config/env.js';
import { hashPassword } from '../src/services/auth.service.js';
import * as requests from '../src/services/request.service.js';
import * as inventory from '../src/services/inventory.service.js';
import * as allocations from '../src/services/allocation.service.js';
import * as dispatches from '../src/services/dispatch.service.js';
import * as alerts from '../src/services/alert.service.js';
import * as orgs from '../src/services/organization.service.js';
import * as offers from '../src/services/offer.service.js';
import * as supplies from '../src/services/supplyOffer.service.js';

export const DEMO_PASSWORD = 'DemoPass2026!';

if (config.isProduction) {
  console.error('Refusing to run the demo seed with NODE_ENV=production.');
  process.exit(1);
}

const req = { id: 'seed', ip: null, get: () => 'seed-script' };

async function wipe() {
  const tables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
}

async function actor(email) {
  const u = await prisma.user.findUnique({ where: { email }, include: { locationAssignments: true, teamMemberships: true } });
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    locationIds: u.locationAssignments.map((a) => a.locationId),
    teamIds: u.teamMemberships.map((m) => m.teamId),
  };
}

async function main() {
  console.log('Seeding DisplaceOS development demo data…');
  await wipe();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // ─── Disaster zones ────────────────────────────────────────────────
  const floodZone = await prisma.disasterZone.create({
    data: {
      name: 'Song River flooding — Raipur area (demo)',
      hazardType: 'FLOOD',
      description: 'Demo scenario: river flooding has cut road access to low-lying neighbourhoods east of the city. Families are sheltering at the Raipur relief camp.',
      status: 'ACTIVE',
      severity: 'RED',
      centerLat: 30.312,
      centerLng: 78.09,
      radiusKm: 6,
      source: 'DisplaceOS demo seed — not a real event',
      isVerified: false,
    },
  });
  const slideZone = await prisma.disasterZone.create({
    data: {
      name: 'Landslide watch — Mussoorie road (demo)',
      hazardType: 'LANDSLIDE',
      description: 'Demo scenario: slopes along the hill road are being monitored after heavy rain. No evacuation order is part of this demo.',
      status: 'MONITORING',
      severity: 'HIGH',
      centerLat: 30.42,
      centerLng: 78.05,
      radiusKm: 5,
      source: 'DisplaceOS demo seed — not a real event',
      isVerified: false,
    },
  });

  // ─── Locations ─────────────────────────────────────────────────────
  const loc = async (data) => prisma.location.create({ data });
  const warehouse = await loc({ name: 'Central Relief Warehouse, Selaqui (demo)', type: 'WAREHOUSE', area: 'Selaqui', address: 'Industrial Area, Selaqui', latitude: 30.37, longitude: 77.87, contactInfo: 'Warehouse desk (demo)' });
  const raipurCamp = await loc({ name: 'Raipur Relief Camp (demo)', type: 'CAMP', area: 'Raipur', address: 'Government school grounds, Raipur', latitude: 30.311, longitude: 78.089, disasterZoneId: floodZone.id, contactInfo: 'Camp help desk (demo)' });
  const rishikeshDp = await loc({ name: 'Rishikesh Distribution Point (demo)', type: 'DISTRIBUTION_POINT', area: 'Rishikesh', address: 'Near bus stand, Rishikesh', latitude: 30.108, longitude: 78.292 });
  const clementShelter = await loc({ name: 'Clement Town Community Shelter (demo)', type: 'SHELTER', area: 'Clement Town', address: 'Community hall, Clement Town', latitude: 30.268, longitude: 78.009 });
  const doiwalaMedical = await loc({ name: 'Doiwala Medical Point (demo)', type: 'MEDICAL_POINT', area: 'Doiwala', address: 'Primary health centre annexe, Doiwala', latitude: 30.176, longitude: 78.121 });
  const mobileKitchen = await loc({ name: 'Mobile Kitchen Unit 3 (demo)', type: 'DISTRIBUTION_POINT', area: 'Moves between camps', address: 'Location varies daily' });

  // ─── Users ─────────────────────────────────────────────────────────
  const user = (email, fullName, role, extra = {}) =>
    prisma.user.create({ data: { email, fullName, role, passwordHash, preference: { create: {} }, ...extra } });
  await user('admin@displaceos.dev', 'Asha Rawat (demo admin)', 'ADMIN');
  await user('coordinator@displaceos.dev', 'Vikram Negi (demo coordinator)', 'RELIEF_COORDINATOR');
  await user('camp.manager@displaceos.dev', 'Meera Bisht (demo camp manager)', 'CAMP_MANAGER', { locationAssignments: { create: [{ locationId: raipurCamp.id }] } });
  await user('inventory@displaceos.dev', 'Rohan Thapa (demo inventory)', 'INVENTORY_MANAGER', {
    locationAssignments: { create: [{ locationId: warehouse.id }, { locationId: rishikeshDp.id }, { locationId: doiwalaMedical.id }, { locationId: mobileKitchen.id }] },
  });
  const alphaUser = await user('team.alpha@displaceos.dev', 'Kabir Chauhan (demo responder)', 'RESPONSE_TEAM');
  const bravoUser = await user('team.bravo@displaceos.dev', 'Neha Joshi (demo responder)', 'RESPONSE_TEAM');
  await user('citizen@displaceos.dev', 'Priya Sharma (demo citizen)', 'CITIZEN', { phone: '+91 90000 00001' });
  await user('citizen2@displaceos.dev', 'Arjun Mehta (demo citizen)', 'CITIZEN');

  const teamAlpha = await prisma.responseTeam.create({
    data: { name: 'Team Alpha (demo)', callSign: 'ALPHA-1', baseLocationId: warehouse.id, members: { create: [{ userId: alphaUser.id, roleInTeam: 'Driver / lead' }] } },
  });
  await prisma.responseTeam.create({
    data: { name: 'Team Bravo (demo)', callSign: 'BRAVO-2', baseLocationId: rishikeshDp.id, members: { create: [{ userId: bravoUser.id, roleInTeam: 'Medic' }] } },
  });

  const admin = await actor('admin@displaceos.dev');
  const coord = await actor('coordinator@displaceos.dev');
  const campMgr = await actor('camp.manager@displaceos.dev');
  const inv = await actor('inventory@displaceos.dev');
  const alpha = await actor('team.alpha@displaceos.dev');
  const citizen = await actor('citizen@displaceos.dev');
  const citizen2 = await actor('citizen2@displaceos.dev');

  // ─── Catalogue ─────────────────────────────────────────────────────
  const items = {};
  const catalogue = [
    ['FOOD-RATION-5KG', 'Dry ration kit (rice, dal, oil — 5 kg)', 'FOOD', 'kits', 40],
    ['FOOD-RTE-MEAL', 'Ready-to-eat meal pack', 'FOOD', 'packs', 100],
    ['FOOD-INFANT', 'Infant formula tin', 'FOOD', 'tins', 15],
    ['WATER-20L', 'Drinking water can (20 L)', 'WATER', 'cans', 50],
    ['WATER-PURIF', 'Water purification tablets (strip of 10)', 'WATER', 'strips', 60],
    ['MED-FIRSTAID', 'First-aid kit', 'MEDICINE', 'kits', 20],
    ['MED-ORS', 'ORS sachets (pack of 10)', 'MEDICINE', 'packs', 50],
    ['MED-BASIC', 'Basic medicine kit (fever, pain, antiseptic)', 'MEDICINE', 'kits', 20],
    ['SHELTER-TARP', 'Tarpaulin sheet (4 × 6 m)', 'SHELTER', 'sheets', 30],
    ['SHELTER-BLANKET', 'Blanket', 'SHELTER', 'pieces', 60],
    ['HYG-FAMILY', 'Family hygiene kit', 'HYGIENE', 'kits', 30],
    ['HYG-SANITARY', 'Sanitary pad pack', 'HYGIENE', 'packs', 40],
    ['CLOTH-CHILD', "Children's clothing set", 'CLOTHING', 'sets', 20],
  ];
  for (const [sku, name, category, unit, lowStockThreshold] of catalogue) {
    items[sku] = await inventory.createItem(admin, { sku, name, category, unit, lowStockThreshold, description: 'Demo catalogue item' }, req);
  }

  // ─── Stock receipts (real transactions) ────────────────────────────
  const receive = (sku, location, quantity) =>
    inventory.recordTransaction(inv, { type: 'RECEIPT', itemId: items[sku].id, locationId: location.id, quantity, reason: 'Opening stock (demo)' }, req);
  const stock = [
    ['FOOD-RATION-5KG', warehouse, 420], ['FOOD-RTE-MEAL', warehouse, 900], ['FOOD-INFANT', warehouse, 60],
    ['WATER-20L', warehouse, 380], ['WATER-PURIF', warehouse, 500], ['MED-FIRSTAID', warehouse, 90],
    ['MED-ORS', warehouse, 300], ['MED-BASIC', warehouse, 70], ['SHELTER-TARP', warehouse, 160],
    ['SHELTER-BLANKET', warehouse, 450], ['HYG-FAMILY', warehouse, 210], ['HYG-SANITARY', warehouse, 260],
    ['CLOTH-CHILD', warehouse, 120],
    ['FOOD-RTE-MEAL', rishikeshDp, 140], ['WATER-20L', rishikeshDp, 45], ['MED-ORS', rishikeshDp, 80],
    ['HYG-FAMILY', rishikeshDp, 25], ['SHELTER-BLANKET', rishikeshDp, 90],
    ['MED-FIRSTAID', doiwalaMedical, 30], ['MED-BASIC', doiwalaMedical, 18], ['MED-ORS', doiwalaMedical, 120],
    ['FOOD-RTE-MEAL', mobileKitchen, 200],
  ];
  for (const [sku, location, qty] of stock) await receive(sku, location, qty);
  // A stock count that is older than the freshness window, to demonstrate "Availability not confirmed".
  await prisma.inventoryBalance.update({
    where: { itemId_locationId: { itemId: items['FOOD-RTE-MEAL'].id, locationId: mobileKitchen.id } },
    data: { lastCountedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000) },
  });
  // Camp-held stock (camp managers do not manage stock; recorded by admin).
  await inventory.recordTransaction(admin, { type: 'RECEIPT', itemId: items['WATER-20L'].id, locationId: raipurCamp.id, quantity: 12, reason: 'Camp store count (demo)' }, req);
  await inventory.recordTransaction(admin, { type: 'RECEIPT', itemId: items['SHELTER-BLANKET'].id, locationId: clementShelter.id, quantity: 40, reason: 'Shelter store count (demo)' }, req);

  // ─── Public zone alert ─────────────────────────────────────────────
  await alerts.createAlert(coord, {
    title: 'Song River water level rising (demo)',
    message: 'Demo alert: families in low-lying parts of Raipur should follow instructions from local authorities. The Raipur relief camp is receiving people and supplies.',
    severity: 'RED',
    disasterZoneId: floodZone.id,
    source: 'Coordinator entry (demo)',
  }, req);
  await alerts.createAlert(coord, {
    title: 'Hill road under landslide watch (demo)',
    message: 'Demo alert: supply vehicles are using the valley route while slopes on the hill road are monitored.',
    severity: 'HIGH',
    disasterZoneId: slideZone.id,
    source: 'Coordinator entry (demo)',
  }, req);

  // ─── Requests through the real workflow ────────────────────────────
  // R1: water at the flooded camp — left SUBMITTED for the verification demo (rules suggest RED → alert).
  await requests.createRequest(citizen, {
    category: 'WATER',
    description: 'Drinking water has run out at our section of the Raipur camp. Many families with small children.',
    peopleAffected: 60,
    vulnerableCount: 14,
    campId: raipurCamp.id,
    items: [{ inventoryItemId: items['WATER-20L'].id, quantity: 40 }, { inventoryItemId: items['WATER-PURIF'].id, quantity: 30 }],
  }, req);

  // R2: food delivery in progress with a partial hand-over and a manual ETA.
  const r2 = await requests.createRequest(citizen, {
    category: 'FOOD',
    description: 'Twenty-five people from flooded houses are staying at the community hall and need food for three days.',
    peopleAffected: 25,
    vulnerableCount: 4,
    destinationAddress: 'Community hall, Clement Town',
    latitude: 30.268,
    longitude: 78.009,
    items: [{ inventoryItemId: items['FOOD-RATION-5KG'].id, quantity: 10 }, { inventoryItemId: items['FOOD-INFANT'].id, quantity: 4 }],
  }, req);
  await requests.verifyRequest(coord, r2.id, { decision: 'VERIFY', reason: 'Confirmed by phone with shelter volunteer (demo)' }, req);
  const a2 = await allocations.createAllocation(coord, {
    requestId: r2.id,
    sourceLocationId: warehouse.id,
    lines: r2.items.map((i) => ({ requestItemId: i.id, quantity: i.quantity })),
    notes: 'Full allocation from central warehouse (demo)',
  }, req);
  await allocations.approveAllocation(coord, a2.id, req);
  const d2 = await dispatches.createDispatch(coord, { allocationId: a2.id, teamId: teamAlpha.id, notes: 'Use valley road (demo)' }, req);
  await dispatches.acceptDispatch(alpha, d2.id, req);
  await dispatches.startDispatch(alpha, d2.id, req);
  await dispatches.setEta(alpha, d2.id, { eta: new Date(Date.now() + 75 * 60000).toISOString(), reason: 'Driver estimate after loading (demo)' }, req);
  await dispatches.updateLocation(alpha, d2.id, { latitude: 30.31, longitude: 77.95 }, req);
  const d2full = await dispatches.getDispatch(coord, d2.id);
  const rationLine = d2full.lines.find((l) => l.item.name.startsWith('Dry ration'));
  await dispatches.completeDispatch(alpha, d2.id, { lines: [{ dispatchLineId: rationLine.id, quantity: 6 }], notes: 'First drop at shelter gate (demo)' }, req);

  // R3: medicine for the camp — verified, allocation proposed and waiting for approval.
  const r3 = await requests.createRequest(campMgr, {
    category: 'MEDICINE',
    description: 'Fever and stomach infections reported among camp residents. Medical volunteers need kits and ORS.',
    peopleAffected: 120,
    vulnerableCount: 15,
    campId: raipurCamp.id,
    items: [{ inventoryItemId: items['MED-BASIC'].id, quantity: 25 }, { inventoryItemId: items['MED-ORS'].id, quantity: 60 }, { inventoryItemId: items['MED-FIRSTAID'].id, quantity: 10 }],
  }, req);
  await requests.verifyRequest(coord, r3.id, { decision: 'VERIFY', reason: 'Camp medical volunteer confirmed cases (demo)' }, req);
  await allocations.createAllocation(coord, {
    requestId: r3.id,
    sourceLocationId: doiwalaMedical.id,
    lines: r3.items.filter((i) => !i.name.startsWith('First-aid')).map((i) => ({ requestItemId: i.id, quantity: Math.min(i.quantity, i.name.startsWith('Basic') ? 18 : i.quantity) })),
    notes: 'Nearest medical stock; remainder to come from warehouse (demo)',
  }, req);

  // R4: shelter request delivered in full.
  const r4 = await requests.createRequest(citizen2, {
    category: 'SHELTER',
    description: 'Roof damaged by storm. Need tarpaulins and blankets for two families.',
    peopleAffected: 8,
    destinationAddress: 'Lane 4, Doiwala',
    latitude: 30.18,
    longitude: 78.118,
    items: [{ inventoryItemId: items['SHELTER-TARP'].id, quantity: 3 }, { inventoryItemId: items['SHELTER-BLANKET'].id, quantity: 8 }],
  }, req);
  await requests.verifyRequest(coord, r4.id, { decision: 'VERIFY', reason: 'Verified with ward volunteer (demo)' }, req);
  const a4 = await allocations.createAllocation(coord, { requestId: r4.id, sourceLocationId: warehouse.id, lines: r4.items.map((i) => ({ requestItemId: i.id, quantity: i.quantity })) }, req);
  await allocations.approveAllocation(inv, a4.id, req);
  const d4 = await dispatches.createDispatch(coord, { allocationId: a4.id, teamId: teamAlpha.id }, req);
  await dispatches.acceptDispatch(alpha, d4.id, req);
  await dispatches.startDispatch(alpha, d4.id, req);
  const d4full = await dispatches.getDispatch(coord, d4.id);
  await dispatches.completeDispatch(alpha, d4.id, { lines: d4full.lines.map((l) => ({ dispatchLineId: l.id, quantity: l.quantity })), notes: 'Handed to family head (demo)' }, req);

  // R5: hygiene request the requester cancelled.
  const r5 = await requests.createRequest(citizen2, {
    category: 'HYGIENE',
    description: 'Hygiene kits for relatives staying with us.',
    peopleAffected: 6,
    destinationAddress: 'Near clock tower, Dehradun',
    items: [{ inventoryItemId: items['HYG-FAMILY'].id, quantity: 2 }],
  }, req);
  await requests.cancelRequest(citizen2, r5.id, 'Relatives received kits at the camp instead (demo)', req);

  // ─── Responder organisations (through the real onboarding flow) ────
  const ngo = await orgs.registerOrganization({
    organization: { name: 'Himalayan Aid Network (demo)', type: 'NGO', area: 'Dehradun and Rishikesh', contactPhone: '+91 90000 00010', description: 'Demo NGO with two vans and trained volunteers.' },
    account: { fullName: 'Ritu Pant (demo NGO lead)', email: 'responder@displaceos.dev', password: DEMO_PASSWORD },
  }, req);
  await orgs.approveOrganization(admin, ngo.organization.id, { note: 'Registration documents checked (demo)' }, req);
  const ngoLead = await actor('responder@displaceos.dev');
  const { joinCode } = await orgs.rotateJoinCode(ngoLead, req);
  await orgs.joinOrganization({ joinCode, account: { fullName: 'Aman Rawat (demo volunteer, pending)', email: 'volunteer@displaceos.dev', password: DEMO_PASSWORD } }, req);
  await prisma.responseTeam.updateMany({ where: { organizationId: ngo.organization.id }, data: { baseLocationId: rishikeshDp.id, lastLatitude: 30.21, lastLongitude: 78.18, lastLocationAt: new Date() } });
  await orgs.registerOrganization({
    organization: { name: 'Clement Town Youth Volunteers (demo)', type: 'VOLUNTEER_GROUP', area: 'Clement Town, Dehradun', contactPhone: '+91 90000 00020' },
    account: { fullName: 'Sahil Gusain (demo, awaiting approval)', email: 'ngo.pending@displaceos.dev', password: DEMO_PASSWORD },
  }, req);
  // The approved NGO offers to deliver the verified medicine request.
  await offers.createOffer(await actor('responder@displaceos.dev'), r3.id, { teamId: (await actor('responder@displaceos.dev')).teamIds[0], note: 'Van free this afternoon; we can collect from Doiwala (demo).', ownSupplies: false }, req);

  // ─── Supply donations ────────────────────────────────────────────
  await prisma.user.create({ data: { email: 'donor@displaceos.dev', fullName: 'Neelam Kapoor (demo donor)', role: 'CITIZEN', passwordHash, preference: { create: {} } } });
  const donor = await actor('donor@displaceos.dev');
  const received = await supplies.createOffer(donor, {
    donorName: 'Kapoor General Store (demo)',
    deliveryMode: 'DROP_OFF',
    notes: 'Left over from our monsoon drive.',
    lines: [{ inventoryItemId: items['HYG-FAMILY'].id, quantity: 20 }, { inventoryItemId: items['SHELTER-BLANKET'].id, quantity: 40 }],
  }, req);
  await supplies.acceptOffer(coord, received.id, { receivingLocationId: warehouse.id, note: 'Use the side gate (demo)' }, req);
  await supplies.receiveOffer(inv, received.id, { lines: received.lines.map((l) => ({ lineId: l.id, receivedQuantity: l.quantity })), note: 'All counted (demo)' }, req);
  await supplies.createOffer(donor, {
    donorName: 'Kapoor General Store (demo)',
    deliveryMode: 'PICKUP',
    pickupAddress: 'Shop 12, Paltan Bazaar, Dehradun (demo)',
    latitude: 30.322,
    longitude: 78.041,
    notes: 'Can load into a van between 10am and 4pm.',
    lines: [{ inventoryItemId: items['WATER-20L'].id, quantity: 60 }, { name: 'Glucose biscuits', unit: 'cartons', quantity: 15 }],
  }, req);

  console.log('\nDemo accounts (development only) — password for all:', DEMO_PASSWORD);
  for (const email of ['admin', 'coordinator', 'camp.manager', 'inventory', 'team.alpha', 'team.bravo', 'citizen', 'citizen2', 'responder', 'volunteer', 'ngo.pending', 'donor']) {
    console.log(`  ${email}@displaceos.dev`);
  }
  console.log('\nSeed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
