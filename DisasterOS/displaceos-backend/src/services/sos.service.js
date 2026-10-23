// Emergency rescue calls (SOS).
//   ACTIVE → RESPONDING (a responder is on the way) → RESOLVED (rescued / not found / false alarm)
//   ACTIVE | RESPONDING → CANCELLED (the person says they are safe)
// Every signed-in screen gets a pop-up, and anonymous visitors see it by polling /sos/active. Only responders and
// relief staff receive the exact position, message and contact details; everyone else sees the approximate area.
// DisplaceOS is not an emergency service: the UI always points to 112 as well.
import { prisma } from '../utils/prisma.js';
import { badRequest, conflict, forbidden, invalidTransition, notFound } from '../utils/errors.js';
import { checkLocation, haversineKm, hasCoords } from '../utils/geo.js';
import { randomBytes } from 'node:crypto';
import { config } from '../config/env.js';
import { Roles } from '../utils/constants.js';
import { audit } from './audit.service.js';
import { notifyRoles, notifyUsers } from './notification.service.js';
import { emit } from '../sockets/emitter.js';

export const SOS_RESPONDERS = [Roles.RESPONSE_TEAM, Roles.RELIEF_COORDINATOR, Roles.ADMIN, Roles.CAMP_MANAGER];
const COORDINATORS = [Roles.RELIEF_COORDINATOR, Roles.ADMIN];
const OPEN = ['ACTIVE', 'RESPONDING'];

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const sosCode = () => `SOS-${[...randomBytes(5)].map((b) => ALPHABET[b % ALPHABET.length]).join('')}`;

const isResponder = (user) => Boolean(user && SOS_RESPONDERS.includes(user.role));

const include = {
  requester: { select: { id: true, fullName: true, phone: true } },
  responder: { select: { id: true, fullName: true, phone: true, teamMemberships: { select: { team: { select: { id: true, name: true } } } } } },
  resolvedBy: { select: { fullName: true, role: true } },
  events: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { fullName: true, role: true } } } },
};

const event = (tx, sosId, type, message, actor) => tx.sosEvent.create({ data: { sosId, type, message, actorId: actor?.id ?? null } });

// A human-readable area that does not reveal the exact spot: nearest known relief location, else the zone, else ~1 km grid.
async function areaLabelFor({ latitude, longitude, address }) {
  if (latitude == null || longitude == null) return address ? 'Location given as an address' : 'Location not shared';
  const locations = await prisma.location.findMany({ where: { isActive: true, latitude: { not: null }, longitude: { not: null } }, select: { name: true, latitude: true, longitude: true } });
  let best = null;
  for (const l of locations) {
    const d = haversineKm(latitude, longitude, l.latitude, l.longitude);
    if (d != null && d <= 15 && (!best || d < best.d)) best = { name: l.name, d };
  }
  if (best) return `about ${Math.max(1, Math.round(best.d))} km from ${best.name}`;
  const zones = await prisma.disasterZone.findMany({ where: { status: 'ACTIVE', centerLat: { not: null }, radiusKm: { not: null } } });
  const zone = zones.find((z) => haversineKm(latitude, longitude, z.centerLat, z.centerLng) <= z.radiusKm);
  if (zone) return `inside ${zone.name}`;
  return `around ${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
}

function shape(user, s) {
  const full = isResponder(user) || s.requesterId === user?.id;
  const team = s.responder?.teamMemberships?.[0]?.team ?? null;
  const base = {
    id: s.id,
    referenceCode: s.referenceCode,
    status: s.status,
    areaLabel: s.areaLabel,
    peopleCount: s.peopleCount,
    createdAt: s.createdAt,
    respondedAt: s.respondedAt,
    respondingTeam: team?.name ?? (s.responder ? 'A responder' : null),
    resolvedAt: s.resolvedAt,
    outcome: s.outcome,
  };
  if (!full) return base;
  return {
    ...base,
    latitude: s.latitude,
    longitude: s.longitude,
    accuracyMeters: s.accuracyM,
    address: s.address,
    message: s.message,
    requester: isResponder(user) ? s.requester : undefined,
    responder: s.responder ? { id: s.responder.id, fullName: s.responder.fullName, phone: isResponder(user) || s.requesterId === user?.id ? s.responder.phone : undefined } : null,
    resolutionNote: s.resolutionNote,
    locationCheck: s.locationCheck,
    resolverDistanceM: s.resolverDistanceM,
    isOwn: s.requesterId === user?.id,
    events: s.events?.map((e) => ({ type: e.type, message: e.message, createdAt: e.createdAt, actor: e.actor ? (isResponder(user) ? e.actor : { role: e.actor.role }) : null })),
  };
}

// What the pop-up broadcast carries: never the exact position, message or identity.
const publicPayload = (s) => ({
  id: s.id,
  referenceCode: s.referenceCode,
  status: s.status,
  areaLabel: s.areaLabel,
  peopleCount: s.peopleCount,
  createdAt: s.createdAt,
});

async function load(id) {
  const s = await prisma.sosAlert.findUnique({ where: { id }, include });
  if (!s) throw notFound('SOS');
  return s;
}

export async function getSos(user, id) {
  const s = await load(id);
  if (!(isResponder(user) || s.requesterId === user.id)) throw notFound('SOS');
  return shape(user, s);
}

export async function activeSos(user) {
  const rows = await prisma.sosAlert.findMany({ where: { status: { in: OPEN } }, include, orderBy: { createdAt: 'desc' }, take: 50 });
  return rows.map((s) => shape(user, s));
}

export async function mySos(user) {
  const rows = await prisma.sosAlert.findMany({ where: { requesterId: user.id }, include, orderBy: { createdAt: 'desc' }, take: 20 });
  return rows.map((s) => shape(user, s));
}

export async function raiseSos(user, input, req) {
  if (input.latitude == null && !input.address) {
    throw badRequest('Share your location or type where you are, so responders can find you', [{ path: 'latitude', message: 'Location or address required' }]);
  }
  const open = await prisma.sosAlert.findFirst({ where: { requesterId: user.id, status: { in: OPEN } } });
  if (open) throw conflict('You already have an active SOS. Responders have been alerted.', [{ sosId: open.id }]);
  const areaLabel = await areaLabelFor(input);
  const sos = await prisma.$transaction(async (tx) => {
    const s = await tx.sosAlert.create({
      data: {
        referenceCode: sosCode(),
        requesterId: user.id,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        accuracyM: input.accuracyMeters ?? null,
        address: input.address ?? null,
        areaLabel,
        message: input.message,
        peopleCount: input.peopleCount ?? 1,
      },
    });
    await event(tx, s.id, 'RAISED', 'SOS sent. All responders and relief staff online have been alerted.', user);
    await audit(tx, { actor: user, action: 'SOS_RAISED', entityType: 'SosAlert', entityId: s.id, after: { areaLabel, peopleCount: s.peopleCount }, req });
    return s;
  });
  emit(['broadcast'], 'sos:created', publicPayload(sos));
  await notifyRoles(SOS_RESPONDERS, {
    type: 'SOS',
    title: `EMERGENCY ${sos.referenceCode}: rescue needed ${areaLabel}`,
    body: `${sos.peopleCount} ${sos.peopleCount === 1 ? 'person' : 'people'}: ${sos.message.slice(0, 200)}`,
    severity: 'HYPER_RED',
    data: { sosId: sos.id },
  });
  return getSos(user, sos.id);
}

export async function updateSosLocation(user, id, { latitude, longitude, accuracyMeters }, req) {
  const s = await load(id);
  if (s.requesterId !== user.id) throw forbidden('Only the person who sent the SOS can update its location');
  if (!OPEN.includes(s.status)) throw invalidTransition(s.status, 'LOCATION_UPDATE', 'SOS');
  const areaLabel = await areaLabelFor({ latitude, longitude });
  await prisma.$transaction(async (tx) => {
    await tx.sosAlert.update({ where: { id }, data: { latitude, longitude, accuracyM: accuracyMeters ?? null, areaLabel } });
    await event(tx, id, 'LOCATION_UPDATED', 'Location updated by the person who needs help', user);
    await audit(tx, { actor: user, action: 'SOS_LOCATION_UPDATED', entityType: 'SosAlert', entityId: id, req });
  });
  emit(['broadcast'], 'sos:updated', { id, status: s.status });
  return getSos(user, id);
}

export async function respond(user, id, req) {
  if (!isResponder(user)) throw forbidden('Only responders and relief staff can respond to an SOS');
  const s = await load(id);
  const { count } = await prisma.sosAlert.updateMany({
    where: { id, status: 'ACTIVE' },
    data: { status: 'RESPONDING', respondingUserId: user.id, respondedAt: new Date() },
  });
  if (count === 0) {
    if (s.status === 'RESPONDING') throw conflict(`${s.responder?.fullName ?? 'Another responder'} is already responding to this SOS`);
    throw invalidTransition(s.status, 'RESPONDING', 'SOS');
  }
  const team = user.teamIds?.length ? await prisma.responseTeam.findUnique({ where: { id: user.teamIds[0] } }) : null;
  await prisma.$transaction(async (tx) => {
    await event(tx, id, 'RESPONDING', `${team ? `${team.name} (${user.fullName})` : user.fullName} is responding`, user);
    await audit(tx, { actor: user, action: 'SOS_RESPONDING', entityType: 'SosAlert', entityId: id, req });
  });
  emit(['broadcast'], 'sos:updated', { id, status: 'RESPONDING' });
  await notifyUsers([s.requesterId], {
    type: 'SOS_RESPONDING',
    title: 'Help is on the way',
    body: `${team?.name ?? user.fullName} has seen your SOS and is responding. Stay where you are if it is safe, and keep your phone on.`,
    severity: 'HYPER_RED',
    data: { sosId: id },
  });
  return getSos(user, id);
}

export async function resolve(user, id, { outcome, note, latitude, longitude, accuracyMeters }, req) {
  const s = await load(id);
  const allowed = COORDINATORS.includes(user.role) || s.respondingUserId === user.id;
  if (!allowed) throw forbidden('Only the responder who took this SOS, or a coordinator, can close it');
  if (!OPEN.includes(s.status)) throw invalidTransition(s.status, 'RESOLVED', 'SOS');
  const check = checkLocation(latitude != null ? { latitude, longitude, accuracyMeters } : null, hasCoords(s) ? s : null, config.HANDOVER_VERIFY_RADIUS_M);
  const { count } = await prisma.sosAlert.updateMany({
    where: { id, status: { in: OPEN } },
    data: {
      status: 'RESOLVED',
      outcome,
      resolutionNote: note,
      resolvedById: user.id,
      resolvedAt: new Date(),
      resolverLatitude: latitude ?? null,
      resolverLongitude: longitude ?? null,
      resolverDistanceM: check.distanceM,
      locationCheck: check.locationCheck,
    },
  });
  if (count === 0) throw invalidTransition(s.status, 'RESOLVED', 'SOS');
  const label = { RESCUED: 'Rescued', NOT_FOUND: 'Person not found at the location', FALSE_ALARM: 'Closed as a false alarm' }[outcome];
  const where = check.locationCheck === 'VERIFIED' ? ` — responder was within ${check.distanceM} m (location verified)` : check.locationCheck === 'TOO_FAR' ? ` — responder was ${check.distanceM} m away` : '';
  await prisma.$transaction(async (tx) => {
    await event(tx, id, 'RESOLVED', `${label}${where}. ${note}`, user);
    await audit(tx, { actor: user, action: 'SOS_RESOLVED', entityType: 'SosAlert', entityId: id, after: { outcome, note, ...check }, req });
  });
  emit(['broadcast'], 'sos:updated', { id, status: 'RESOLVED' });
  await notifyUsers([s.requesterId], { type: 'SOS_RESOLVED', title: `Your SOS ${s.referenceCode} was closed`, body: `${label}. ${note}`, data: { sosId: id } });
  return getSos(user, id);
}

export async function cancel(user, id, { reason }, req) {
  const s = await load(id);
  if (s.requesterId !== user.id && !COORDINATORS.includes(user.role)) throw forbidden();
  const { count } = await prisma.sosAlert.updateMany({ where: { id, status: { in: OPEN } }, data: { status: 'CANCELLED', resolutionNote: reason, resolvedAt: new Date(), resolvedById: user.id } });
  if (count === 0) throw invalidTransition(s.status, 'CANCELLED', 'SOS');
  await prisma.$transaction(async (tx) => {
    await event(tx, id, 'CANCELLED', s.requesterId === user.id ? `The person reported they are safe: ${reason}` : `Closed by a coordinator: ${reason}`, user);
    await audit(tx, { actor: user, action: 'SOS_CANCELLED', entityType: 'SosAlert', entityId: id, after: { reason }, req });
  });
  emit(['broadcast'], 'sos:updated', { id, status: 'CANCELLED' });
  if (s.respondingUserId && s.respondingUserId !== user.id) {
    await notifyUsers([s.respondingUserId], { type: 'SOS_CANCELLED', title: `${s.referenceCode} cancelled`, body: reason, data: { sosId: id } });
  }
  return getSos(user, id);
}

