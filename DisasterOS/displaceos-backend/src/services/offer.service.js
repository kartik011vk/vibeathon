// Open needs board and team offers.
// Response teams see verified requests that still need a delivery, without the requester's identity, contact
// details or exact address. Positions are rounded to about 1 km. A team can offer to deliver; a relief
// coordinator then assigns the dispatch (stock still has to be reserved through an allocation).
import { prisma } from '../utils/prisma.js';
import { conflict, forbidden, invalidTransition, notFound } from '../utils/errors.js';
import { haversineKm, hasCoords } from '../utils/geo.js';
import { Roles, SEVERITY_LABELS, severityRank } from '../utils/constants.js';
import { audit } from './audit.service.js';
import { addTimelineEvent } from './timeline.service.js';
import { isCoordinator, isTeamMember } from './access.service.js';
import { notifyRoles } from './notification.service.js';
import { emit, rooms } from '../sockets/emitter.js';

const NEEDS_DELIVERY = ['VERIFIED', 'ALLOCATED', 'PARTIALLY_DELIVERED'];
const OPEN_DISPATCH = ['CREATED', 'ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED'];
const round2 = (n) => Math.round(n * 100) / 100;

function needsDeliveryWhere() {
  return { status: { in: NEEDS_DELIVERY }, dispatches: { none: { status: { in: OPEN_DISPATCH } } } };
}

async function originFor(user, q) {
  if (q.latitude != null && q.longitude != null) return { latitude: q.latitude, longitude: q.longitude, label: 'the point you chose' };
  if (!user.teamIds?.length) return null;
  const team = await prisma.responseTeam.findFirst({ where: { id: { in: user.teamIds } }, include: { baseLocation: true } });
  if (team?.lastLatitude != null && team.lastLongitude != null) return { latitude: team.lastLatitude, longitude: team.lastLongitude, label: `${team.name}'s last position` };
  if (hasCoords(team?.baseLocation)) return { latitude: team.baseLocation.latitude, longitude: team.baseLocation.longitude, label: `${team.name}'s base` };
  return null;
}

export async function openNeeds(user, q) {
  const rows = await prisma.reliefRequest.findMany({
    where: { ...needsDeliveryWhere(), ...(q.category ? { category: q.category } : {}) },
    include: {
      items: true,
      camp: { select: { name: true, area: true, latitude: true, longitude: true } },
      disasterZone: { select: { name: true } },
      teamOffers: { where: { status: 'OPEN' }, select: { teamId: true } },
      allocations: { where: { status: 'APPROVED' }, select: { id: true } },
    },
    take: 300,
  });
  const origin = await originFor(user, q);
  const items = rows.map((r) => {
    const point = hasCoords(r) ? { latitude: round2(r.latitude), longitude: round2(r.longitude) } : hasCoords(r.camp) ? { latitude: r.camp.latitude, longitude: r.camp.longitude } : null;
    const distanceKm = origin && point ? haversineKm(origin.latitude, origin.longitude, point.latitude, point.longitude) : null;
    return {
      id: r.id,
      referenceCode: r.referenceCode,
      category: r.category,
      status: r.status,
      severity: r.severity,
      severityLabel: SEVERITY_LABELS[r.severity],
      peopleAffected: r.peopleAffected,
      vulnerableCount: r.vulnerableCount,
      area: r.camp ? `${r.camp.name}${r.camp.area ? `, ${r.camp.area}` : ''}` : r.disasterZone?.name ?? null,
      approximateLocation: point,
      locationPrecision: point ? (hasCoords(r) ? 'ROUNDED_1KM' : 'CAMP') : null,
      distanceKm,
      distanceBasis: distanceKm != null ? 'STRAIGHT_LINE' : null,
      items: r.items.map((i) => ({ name: i.name, unit: i.unit, remaining: Math.max(0, i.quantity - i.deliveredQuantity) })).filter((i) => i.remaining > 0),
      suppliesReserved: r.allocations.length > 0,
      offersCount: r.teamOffers.length,
      offeredByMyTeam: r.teamOffers.some((o) => user.teamIds?.includes(o.teamId)),
      createdAt: r.createdAt,
    };
  });
  items.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9) || a.createdAt - b.createdAt);
  return {
    items,
    meta: { origin, note: 'Requester identity and exact address are shared only with the team that is assigned. Locations are rounded to about 1 km.' },
  };
}

export async function createOffer(user, requestId, { teamId, note, ownSupplies }, req) {
  if (!isTeamMember(user, teamId)) throw forbidden('You can only offer on behalf of your own team');
  const request = await prisma.reliefRequest.findFirst({ where: { id: requestId, ...needsDeliveryWhere() } });
  if (!request) throw notFound('Open request');
  const team = await prisma.responseTeam.findUnique({ where: { id: teamId } });
  let offer;
  try {
    offer = await prisma.$transaction(async (tx) => {
      const o = await tx.teamOffer.create({ data: { requestId, teamId, offeredById: user.id, note, ownSupplies: Boolean(ownSupplies) } });
      await addTimelineEvent(tx, {
        requestId,
        type: 'TEAM_OFFERED',
        message: `${team.name} offered to deliver${ownSupplies ? ' (can bring own supplies)' : ''}`,
        actor: user,
        isPublic: false,
        data: { offerId: o.id, teamId },
      });
      await audit(tx, { actor: user, action: 'TEAM_OFFER_CREATED', entityType: 'TeamOffer', entityId: o.id, after: { requestId, teamId, ownSupplies }, req });
      return o;
    });
  } catch (err) {
    if (err?.code === 'P2002') throw conflict('Your team has already offered to deliver this request');
    throw err;
  }
  emit([rooms.ops, rooms.request(requestId)], 'request:updated', { id: requestId });
  await notifyRoles([Roles.RELIEF_COORDINATOR], {
    type: 'TEAM_OFFERED',
    title: `${team.name} offered to deliver ${request.referenceCode}`,
    body: note ?? 'Open the request to assign this team.',
    severity: request.severity,
    data: { requestId },
  });
  return offer;
}

export async function listOffers(user, requestId) {
  const where = { requestId, ...(isCoordinator(user) ? {} : { teamId: { in: user.teamIds ?? [] } }) };
  if (!isCoordinator(user) && user.role !== Roles.RESPONSE_TEAM) throw forbidden();
  const offers = await prisma.teamOffer.findMany({
    where,
    include: {
      team: { select: { id: true, name: true, availability: true, organization: { select: { name: true, type: true } } } },
      offeredBy: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return offers;
}

export async function withdrawOffer(user, requestId, offerId, req) {
  const offer = await prisma.teamOffer.findFirst({ where: { id: offerId, requestId } });
  if (!offer) throw notFound('Offer');
  if (!isTeamMember(user, offer.teamId)) throw forbidden('Only the offering team can withdraw this offer');
  const { count } = await prisma.teamOffer.updateMany({ where: { id: offerId, status: 'OPEN' }, data: { status: 'WITHDRAWN' } });
  if (count === 0) throw invalidTransition(offer.status, 'WITHDRAWN', 'Offer');
  await audit(null, { actor: user, action: 'TEAM_OFFER_WITHDRAWN', entityType: 'TeamOffer', entityId: offerId, req });
  emit([rooms.ops], 'request:updated', { id: requestId });
  return { ...offer, status: 'WITHDRAWN' };
}

// Called inside the dispatch-creation transaction.
export function acceptOffersTx(tx, requestId, teamId) {
  return tx.teamOffer.updateMany({ where: { requestId, teamId, status: 'OPEN' }, data: { status: 'ACCEPTED' } });
}

export function declineOpenOffersTx(tx, requestId) {
  return tx.teamOffer.updateMany({ where: { requestId, status: 'OPEN' }, data: { status: 'DECLINED' } });
}

