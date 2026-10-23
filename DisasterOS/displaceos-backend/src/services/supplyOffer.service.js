// Supply donations: PENDING → ACCEPTED (receiving location chosen) → RECEIVED (stock recorded)
//                                       ↘ REJECTED / CANCELLED
// Offered quantities never count as stock. Only quantities physically received and counted by an inventory
// manager are added, through the normal inventory ledger.
import { prisma } from '../utils/prisma.js';
import { badRequest, forbidden, invalidTransition, notFound } from '../utils/errors.js';
import { randomBytes } from 'node:crypto';
import { pageMeta } from '../utils/pagination.js';
import { Roles } from '../utils/constants.js';
import { audit } from './audit.service.js';
import { receiveStockTx, STOCK_LOCATION_TYPES } from './inventory.service.js';
import { notifyRoles, notifyUsers } from './notification.service.js';
import { emit, rooms } from '../sockets/emitter.js';

const HANDLERS = [Roles.RELIEF_COORDINATOR, Roles.ADMIN, Roles.INVENTORY_MANAGER];
const isHandler = (user) => HANDLERS.includes(user.role);

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function donationCode() {
  let c = '';
  for (const b of randomBytes(6)) c += ALPHABET[b % ALPHABET.length];
  return `DN-${c}`;
}

const include = {
  lines: { include: { inventoryItem: { select: { id: true, name: true, unit: true, category: true } } } },
  events: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { fullName: true, role: true } } } },
  receivingLocation: { select: { id: true, name: true, type: true, area: true, address: true, latitude: true, longitude: true } },
  donor: { select: { id: true, fullName: true, email: true, phone: true } },
  handledBy: { select: { fullName: true } },
};

const event = (tx, offerId, type, message, actor) => tx.supplyOfferEvent.create({ data: { offerId, type, message, actorId: actor?.id ?? null } });

// What happened at the receiving location after the donation arrived. Stock is pooled, so this is
// reported as activity at that location — not as a claim that these exact units reached these people.
async function impactFor(offer) {
  if (offer.status !== 'RECEIVED' || !offer.receivingLocationId || !offer.receivedAt) return null;
  const events = await prisma.deliveryEvent.findMany({
    where: { createdAt: { gte: offer.receivedAt }, dispatch: { allocation: { sourceLocationId: offer.receivingLocationId } } },
    select: { dispatch: { select: { requestId: true, request: { select: { peopleAffected: true } } } } },
  });
  const requests = new Map(events.map((e) => [e.dispatch.requestId, e.dispatch.request.peopleAffected]));
  return {
    deliveriesSinceArrival: events.length,
    requestsServedSinceArrival: requests.size,
    peopleInThoseRequests: [...requests.values()].reduce((a, b) => a + b, 0),
    note: 'Donated stock is pooled with other stock at this location, so these figures describe deliveries made from the location since your donation arrived.',
  };
}

function shape(user, o, impact) {
  const staff = isHandler(user);
  return {
    id: o.id,
    referenceCode: o.referenceCode,
    donorName: o.donorName,
    donor: staff ? o.donor : undefined,
    deliveryMode: o.deliveryMode,
    pickupAddress: o.pickupAddress,
    latitude: o.latitude,
    longitude: o.longitude,
    availableFrom: o.availableFrom,
    notes: o.notes,
    status: o.status,
    decisionNote: o.decisionNote,
    receivingLocation: o.receivingLocation,
    handledBy: staff ? o.handledBy : undefined,
    receivedAt: o.receivedAt,
    lines: o.lines.map((l) => ({
      id: l.id,
      name: l.inventoryItem?.name ?? l.name,
      unit: l.inventoryItem?.unit ?? l.unit,
      quantity: l.quantity,
      receivedQuantity: l.receivedQuantity,
      inventoryItemId: l.inventoryItemId,
      offeredName: l.name,
    })),
    events: o.events.map((e) => ({ type: e.type, message: e.message, createdAt: e.createdAt, actor: e.actor ? (staff ? e.actor : { role: e.actor.role }) : null })),
    impact: impact ?? null,
    isOwn: o.donorId === user.id,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

async function load(user, id) {
  const o = await prisma.supplyOffer.findUnique({ where: { id }, include });
  if (!o || (!isHandler(user) && o.donorId !== user.id)) throw notFound('Supply offer');
  return o;
}

export async function getOffer(user, id) {
  const o = await load(user, id);
  return shape(user, o, await impactFor(o));
}

export async function createOffer(user, input, req) {
  const catalogueIds = input.lines.map((l) => l.inventoryItemId).filter(Boolean);
  const catalogue = catalogueIds.length ? await prisma.inventoryItem.findMany({ where: { id: { in: catalogueIds }, isActive: true } }) : [];
  const lines = input.lines.map((l, idx) => {
    if (l.inventoryItemId) {
      const c = catalogue.find((x) => x.id === l.inventoryItemId);
      if (!c) throw badRequest('Unknown supply item', [{ path: `lines.${idx}.inventoryItemId` }]);
      return { inventoryItemId: c.id, name: c.name, unit: c.unit, quantity: l.quantity };
    }
    if (!l.name || !l.unit) throw badRequest('Items without a catalogue id need a name and unit', [{ path: `lines.${idx}` }]);
    return { inventoryItemId: null, name: l.name, unit: l.unit, quantity: l.quantity };
  });
  if (input.deliveryMode === 'PICKUP' && !input.pickupAddress) {
    throw badRequest('A pickup address is needed for collection', [{ path: 'pickupAddress', message: 'Required for pickup' }]);
  }
  const offer = await prisma.$transaction(async (tx) => {
    const o = await tx.supplyOffer.create({
      data: {
        referenceCode: donationCode(),
        donorId: user.id,
        donorName: input.donorName ?? user.fullName,
        deliveryMode: input.deliveryMode,
        pickupAddress: input.pickupAddress ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
        notes: input.notes ?? null,
        lines: { create: lines },
      },
    });
    await event(tx, o.id, 'OFFERED', 'Offer received. Relief staff will review it and tell you where the supplies should go.', user);
    await audit(tx, { actor: user, action: 'SUPPLY_OFFER_CREATED', entityType: 'SupplyOffer', entityId: o.id, after: { lines: lines.length, deliveryMode: input.deliveryMode }, req });
    return o;
  });
  const units = lines.reduce((s, l) => s + l.quantity, 0);
  await notifyRoles([Roles.RELIEF_COORDINATOR, Roles.INVENTORY_MANAGER], {
    type: 'SUPPLY_OFFERED',
    title: `New supply offer ${offer.referenceCode}`,
    body: `${offer.donorName} offers ${units} units (${lines.map((l) => l.name).join(', ').slice(0, 160)}).`,
    data: { supplyOfferId: offer.id },
  });
  emit([rooms.ops, rooms.inventory], 'supply:updated', { id: offer.id, status: offer.status });
  return getOffer(user, offer.id);
}

export async function listOffers(user, q) {
  const where = {
    ...(isHandler(user) && !q.mine ? {} : { donorId: user.id }),
    ...(q.status ? { status: q.status } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.supplyOffer.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.supplyOffer.count({ where }),
  ]);
  return { items: items.map((o) => shape(user, o)), meta: pageMeta(q, total) };
}

function assertCanReceiveAt(user, locationId) {
  if (user.role === Roles.ADMIN) return;
  if (user.role === Roles.INVENTORY_MANAGER && user.locationIds.includes(locationId)) return;
  throw forbidden('Only the inventory manager of the receiving location can record this');
}

export async function acceptOffer(user, id, { receivingLocationId, note, lines = [] }, req) {
  if (!isHandler(user)) throw forbidden();
  const location = await prisma.location.findUnique({ where: { id: receivingLocationId } });
  if (!location || !location.isActive || !STOCK_LOCATION_TYPES.includes(location.type)) {
    throw badRequest('Choose an active stock location', [{ path: 'receivingLocationId' }]);
  }
  const current = await load(user, id);
  const mapping = new Map(lines.map((l) => [l.lineId, l.inventoryItemId]));
  const unmapped = current.lines.filter((l) => !l.inventoryItemId && !mapping.get(l.id));
  if (unmapped.length) {
    throw badRequest('Match every offered item to a stock catalogue item before accepting', unmapped.map((l) => ({ lineId: l.id, name: l.name })));
  }
  if (mapping.size) {
    const found = await prisma.inventoryItem.count({ where: { id: { in: [...mapping.values()] }, isActive: true } });
    if (found !== new Set(mapping.values()).size) throw badRequest('Unknown catalogue item in mapping');
  }
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.supplyOffer.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'ACCEPTED', receivingLocationId, handledById: user.id, decisionNote: note ?? null },
    });
    if (count === 0) throw invalidTransition(current.status, 'ACCEPTED', 'Supply offer');
    for (const [lineId, inventoryItemId] of mapping) {
      await tx.supplyOfferLine.updateMany({ where: { id: lineId, offerId: id }, data: { inventoryItemId } });
    }
    const where = `${location.name}${location.address ? ` (${location.address})` : ''}`;
    await event(
      tx,
      id,
      'ACCEPTED',
      current.deliveryMode === 'DROP_OFF'
        ? `Accepted. Please bring the supplies to ${where}.${note ? ` Note: ${note}` : ''}`
        : `Accepted. Supplies will be collected from your address and taken to ${where}.${note ? ` Note: ${note}` : ''}`,
      user,
    );
    await audit(tx, { actor: user, action: 'SUPPLY_OFFER_ACCEPTED', entityType: 'SupplyOffer', entityId: id, after: { receivingLocationId, note }, req });
  });
  await notifyUsers([current.donorId], {
    type: 'SUPPLY_ACCEPTED',
    title: `Your offer ${current.referenceCode} was accepted`,
    body: current.deliveryMode === 'DROP_OFF' ? `Please bring it to ${location.name}.` : `It will be collected and taken to ${location.name}.`,
    data: { supplyOfferId: id },
  });
  emit([rooms.ops, rooms.inventory, rooms.user(current.donorId)], 'supply:updated', { id, status: 'ACCEPTED' });
  return getOffer(user, id);
}

export async function receiveOffer(user, id, { lines, note }, req) {
  const current = await load(user, id);
  if (current.status !== 'ACCEPTED') throw invalidTransition(current.status, 'RECEIVED', 'Supply offer');
  assertCanReceiveAt(user, current.receivingLocationId);
  const byId = new Map(current.lines.map((l) => [l.id, l]));
  for (const [idx, l] of lines.entries()) {
    if (!byId.has(l.lineId)) throw badRequest('Line does not belong to this offer', [{ path: `lines.${idx}.lineId` }]);
  }
  const counted = new Map(lines.map((l) => [l.lineId, l.receivedQuantity]));
  const total = [...counted.values()].reduce((a, b) => a + b, 0);
  if (total === 0) throw badRequest('Record at least one received quantity, or reject the offer instead');

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.supplyOffer.updateMany({ where: { id, status: 'ACCEPTED' }, data: { status: 'RECEIVED', receivedAt: new Date(), handledById: user.id } });
    if (count === 0) throw invalidTransition(current.status, 'RECEIVED', 'Supply offer');
    for (const line of current.lines) {
      const qty = counted.get(line.id) ?? 0;
      await tx.supplyOfferLine.update({ where: { id: line.id }, data: { receivedQuantity: qty } });
      if (qty > 0) {
        await receiveStockTx(tx, { itemId: line.inventoryItemId, locationId: current.receivingLocationId, quantity: qty, reason: `Donation ${current.referenceCode} from ${current.donorName}`, actor: user });
      }
    }
    const summary = current.lines.map((l) => `${counted.get(l.id) ?? 0} of ${l.quantity} ${l.unit} ${l.name}`).join(', ');
    await event(tx, id, 'RECEIVED', `Received and counted at ${current.receivingLocation.name}: ${summary}.${note ? ` ${note}` : ''}`, user);
    await audit(tx, { actor: user, action: 'SUPPLY_OFFER_RECEIVED', entityType: 'SupplyOffer', entityId: id, after: { lines, note }, req });
  });
  await notifyUsers([current.donorId], {
    type: 'SUPPLY_RECEIVED',
    title: `Thank you — ${current.referenceCode} has arrived`,
    body: `Your supplies were counted into stock at ${current.receivingLocation.name}.`,
    data: { supplyOfferId: id },
  });
  emit([rooms.ops, rooms.inventory, rooms.user(current.donorId)], 'supply:updated', { id, status: 'RECEIVED' });
  emit([rooms.inventory, rooms.ops], 'inventory:updated', { locationId: current.receivingLocationId });
  return getOffer(user, id);
}

export async function rejectOffer(user, id, { reason }, req) {
  if (!isHandler(user)) throw forbidden();
  const current = await load(user, id);
  const { count } = await prisma.supplyOffer.updateMany({ where: { id, status: { in: ['PENDING', 'ACCEPTED'] } }, data: { status: 'REJECTED', handledById: user.id, decisionNote: reason } });
  if (count === 0) throw invalidTransition(current.status, 'REJECTED', 'Supply offer');
  await prisma.$transaction(async (tx) => {
    await event(tx, id, 'REJECTED', `Not accepted: ${reason}`, user);
    await audit(tx, { actor: user, action: 'SUPPLY_OFFER_REJECTED', entityType: 'SupplyOffer', entityId: id, after: { reason }, req });
  });
  await notifyUsers([current.donorId], { type: 'SUPPLY_REJECTED', title: `Offer ${current.referenceCode} was not accepted`, body: reason, data: { supplyOfferId: id } });
  emit([rooms.ops, rooms.inventory], 'supply:updated', { id, status: 'REJECTED' });
  return getOffer(user, id);
}

export async function cancelOffer(user, id, { reason }, req) {
  const current = await load(user, id);
  if (current.donorId !== user.id) throw forbidden('Only the donor can withdraw this offer');
  const { count } = await prisma.supplyOffer.updateMany({ where: { id, status: { in: ['PENDING', 'ACCEPTED'] } }, data: { status: 'CANCELLED', decisionNote: reason } });
  if (count === 0) throw invalidTransition(current.status, 'CANCELLED', 'Supply offer');
  await prisma.$transaction(async (tx) => {
    await event(tx, id, 'CANCELLED', `Withdrawn by donor: ${reason}`, user);
    await audit(tx, { actor: user, action: 'SUPPLY_OFFER_CANCELLED', entityType: 'SupplyOffer', entityId: id, after: { reason }, req });
  });
  emit([rooms.ops, rooms.inventory], 'supply:updated', { id, status: 'CANCELLED' });
  return getOffer(user, id);
}
