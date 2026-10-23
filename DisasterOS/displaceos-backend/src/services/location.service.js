import { prisma } from '../utils/prisma.js';
import { notFound } from '../utils/errors.js';
import { SEVERITY_LABELS, Roles, OPEN_REQUEST_STATUSES } from '../utils/constants.js';
import { audit } from './audit.service.js';
import { availabilityStatus, STOCK_LOCATION_TYPES } from './inventory.service.js';
import { requestScope, isCoordinator } from './access.service.js';
import { isLocationStale } from './team.service.js';
import { routingStatus } from '../adapters/index.js';
import { emit } from '../sockets/emitter.js';

const publicLocation = (l) => ({
  id: l.id,
  name: l.name,
  type: l.type,
  address: l.address,
  area: l.area,
  latitude: l.latitude,
  longitude: l.longitude,
  contactInfo: l.contactInfo,
  disasterZoneId: l.disasterZoneId,
  updatedAt: l.updatedAt,
});

export async function createLocation(user, data, req) {
  const location = await prisma.location.create({ data });
  await audit(null, { actor: user, action: 'LOCATION_CREATED', entityType: 'Location', entityId: location.id, after: data, req });
  return publicLocation(location);
}

export async function listLocations(q) {
  const where = {
    isActive: true,
    ...(q.type ? { type: { in: q.type } } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { area: { contains: q.search, mode: 'insensitive' } }] } : {}),
  };
  const items = await prisma.location.findMany({ where, orderBy: { name: 'asc' }, take: 500 });
  return items.map(publicLocation);
}

export async function getLocation(id) {
  const l = await prisma.location.findFirst({
    where: { id, isActive: true },
    include: { disasterZone: { select: { id: true, name: true, hazardType: true, status: true } } },
  });
  if (!l) throw notFound('Location');
  return { ...publicLocation(l), disasterZone: l.disasterZone };
}

// ─── Disaster zones ──────────────────────────────────────────────────────

const shapeZone = (z) => ({ ...z, severityLabel: SEVERITY_LABELS[z.severity], createdById: undefined });

export async function listZones(q) {
  const zones = await prisma.disasterZone.findMany({
    where: q.status ? { status: { in: q.status } } : {},
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    include: { _count: { select: { locations: true } } },
  });
  return zones.map(shapeZone);
}

export async function getZone(id) {
  const z = await prisma.disasterZone.findUnique({
    where: { id },
    include: {
      locations: { where: { isActive: true }, select: { id: true, name: true, type: true, area: true } },
      alerts: { where: { requestId: null, status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } }, select: { id: true, title: true, message: true, severity: true, source: true, createdAt: true } },
    },
  });
  if (!z) throw notFound('Disaster zone');
  return shapeZone(z);
}

export async function createZone(user, data, req) {
  const zone = await prisma.disasterZone.create({ data: { ...data, createdById: user.id } });
  await audit(null, { actor: user, action: 'DISASTER_ZONE_CREATED', entityType: 'DisasterZone', entityId: zone.id, after: data, req });
  emit(['broadcast'], 'zone:updated', { id: zone.id, status: zone.status });
  return shapeZone(zone);
}

export async function updateZone(user, id, data, req) {
  const before = await prisma.disasterZone.findUnique({ where: { id } });
  if (!before) throw notFound('Disaster zone');
  const zone = await prisma.disasterZone.update({ where: { id }, data });
  await audit(null, { actor: user, action: 'DISASTER_ZONE_UPDATED', entityType: 'DisasterZone', entityId: id, before, after: data, req });
  emit(['broadcast'], 'zone:updated', { id, status: zone.status });
  return shapeZone(zone);
}

// ─── Map-ready data ──────────────────────────────────────────────────────

export async function mapResources(q) {
  const locations = await prisma.location.findMany({
    where: {
      isActive: true,
      latitude: { not: null },
      longitude: { not: null },
      ...(q.type ? { type: { in: q.type } } : {}),
    },
    include: { balances: { include: { item: true }, where: q.category ? { item: { category: q.category } } : undefined } },
  });
  return locations.map((l) => {
    const supplies = l.balances.map((b) => {
      const { status } = availabilityStatus(b, b.item);
      return {
        itemId: b.item.id,
        name: b.item.name,
        category: b.item.category,
        unit: b.item.unit,
        available: status === 'NOT_CONFIRMED' ? null : Math.max(0, b.onHand - b.reserved),
        availabilityStatus: status,
        lastConfirmedAt: b.lastCountedAt,
      };
    });
    return {
      ...publicLocation(l),
      holdsStock: STOCK_LOCATION_TYPES.includes(l.type),
      categories: [...new Set(supplies.filter((s) => ['AVAILABLE', 'LIMITED'].includes(s.availabilityStatus)).map((s) => s.category))],
      supplies,
    };
  });
}

export async function mapRequests(user, q) {
  const rows = await prisma.reliefRequest.findMany({
    where: {
      AND: [
        requestScope(user),
        { latitude: { not: null }, longitude: { not: null } },
        q.status ? { status: { in: q.status } } : { status: { in: OPEN_REQUEST_STATUSES } },
        q.severity ? { severity: { in: q.severity } } : {},
      ],
    },
    select: { id: true, referenceCode: true, category: true, status: true, severity: true, peopleAffected: true, latitude: true, longitude: true, requesterId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return rows.map(({ requesterId, ...r }) => ({ ...r, severityLabel: SEVERITY_LABELS[r.severity], isOwn: requesterId === user.id }));
}

export async function mapTeams(user) {
  const where = isCoordinator(user) ? {} : user.role === Roles.RESPONSE_TEAM ? { id: { in: user.teamIds } } : { id: '00000000-0000-0000-0000-000000000000' };
  const teams = await prisma.responseTeam.findMany({ where: { ...where, lastLatitude: { not: null }, lastLongitude: { not: null } } });
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    callSign: t.callSign,
    availability: t.availability,
    latitude: t.lastLatitude,
    longitude: t.lastLongitude,
    accuracyMeters: t.lastAccuracyM,
    updatedAt: t.lastLocationAt,
    stale: isLocationStale(t.lastLocationAt),
  }));
}

export function routeEstimate() {
  const status = routingStatus();
  return {
    available: false,
    ...status,
    note: 'Road distance and travel time require a routing provider. Map tiles alone cannot produce a route ETA.',
  };
}
