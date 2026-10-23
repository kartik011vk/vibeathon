// Live hazard information for India from external feeds (NDMA SACHET, USGS, GDACS).
// Feeds are polled by src/jobs/hazardFeed.job.js. Each source's health is recorded so the UI never presents a
// failed or stale feed as live. Feed items are information; coordinators decide whether to open a disaster zone.
import { prisma } from '../utils/prisma.js';
import { conflict, notFound, badRequest } from '../utils/errors.js';
import { haversineKm } from '../utils/geo.js';
import { severityRank, SEVERITY_LABELS, Roles } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { FEEDS } from '../adapters/hazards/feeds.js';
import { audit } from './audit.service.js';
import { notifyRoles } from './notification.service.js';
import { emit } from '../sockets/emitter.js';

const HIGH_IMPACT = ['EARTHQUAKE', 'FLOOD', 'CYCLONE', 'TSUNAMI', 'LANDSLIDE'];
const RECENT_MS = 2 * 3600 * 1000;

// Which new events interrupt every screen. Everything else is listed without a pop-up.
export function popupWorthy(e) {
  if (e.hazardType === 'EARTHQUAKE') return (e.magnitude ?? 0) >= 4.5 || severityRank(e.severity) >= severityRank('RED');
  if (e.source === 'GDACS') return severityRank(e.severity) >= severityRank('RED');
  if (e.severity === 'HYPER_RED') return true;
  return e.severity === 'RED' && HIGH_IMPACT.includes(e.hazardType);
}

export const publicHazard = (e) => ({
  id: e.id,
  source: e.source,
  hazardType: e.hazardType,
  title: e.title,
  areaDescription: e.areaDescription,
  state: e.state,
  latitude: e.latitude,
  longitude: e.longitude,
  severity: e.severity,
  severityLabel: SEVERITY_LABELS[e.severity],
  sourceSeverity: e.sourceSeverity,
  magnitude: e.magnitude,
  isOfficial: e.isOfficial,
  startsAt: e.startsAt,
  expiresAt: e.expiresAt,
  sourceUrl: e.sourceUrl,
  instruction: e.instruction,
  disasterZoneId: e.disasterZoneId,
  popup: popupWorthy(e),
  firstSeenAt: e.firstSeenAt,
});

const FIELDS = ['hazardType', 'title', 'areaDescription', 'state', 'latitude', 'longitude', 'severity', 'sourceSeverity', 'magnitude', 'isOfficial', 'startsAt', 'expiresAt', 'sourceUrl', 'instruction'];

async function setStatus(source, data) {
  await prisma.hazardFeedStatus.upsert({ where: { source }, update: data, create: { source, ...data } });
}

// Polls every feed once. Returns { [source]: { ok, received, created, error } }.
export async function runFeeds({ fetchImpl = fetch, feeds = FEEDS, announce = true } = {}) {
  const summary = {};
  const created = [];
  for (const feed of feeds) {
    await setStatus(feed.source, { lastAttemptAt: new Date() });
    try {
      const known = new Set((await prisma.hazardFeedEvent.findMany({ where: { source: feed.source }, select: { externalId: true } })).map((r) => r.externalId));
      const events = await feed.fetchEvents({ fetchImpl, knownIds: known });
      let newCount = 0;
      for (const ev of events) {
        const data = Object.fromEntries(FIELDS.map((k) => [k, ev[k] ?? null]));
        if (ev.cancelled) data.expiresAt = new Date();
        const existing = await prisma.hazardFeedEvent.findUnique({ where: { source_externalId: { source: ev.source, externalId: ev.externalId } } });
        if (existing) {
          await prisma.hazardFeedEvent.update({ where: { id: existing.id }, data: { ...data, lastSeenAt: new Date() } });
        } else {
          const row = await prisma.hazardFeedEvent.create({ data: { ...data, source: ev.source, externalId: ev.externalId } });
          created.push(row);
          newCount += 1;
        }
      }
      await setStatus(feed.source, { lastSuccessAt: new Date(), lastError: null, lastCount: events.length });
      summary[feed.source] = { ok: true, received: events.length, created: newCount };
    } catch (err) {
      const message = String(err?.message ?? err).slice(0, 300);
      await setStatus(feed.source, { lastError: message });
      summary[feed.source] = { ok: false, error: message };
      logger.warn({ source: feed.source, err: message }, 'Hazard feed failed');
    }
  }
  if (announce) await announceNew(created);
  return { summary, created: created.length };
}

// Only events that started recently interrupt screens, so the first import of a backlog does not flood users.
async function announceNew(rows) {
  const fresh = rows.filter((r) => Date.now() - new Date(r.startsAt).getTime() < RECENT_MS && popupWorthy(r));
  for (const r of fresh.slice(0, 5)) {
    emit(['broadcast'], 'hazard:new', publicHazard(r));
    await notifyRoles([Roles.RELIEF_COORDINATOR, Roles.ADMIN], {
      type: 'HAZARD_FEED',
      title: `${r.title}${r.state ? ` — ${r.state}` : ''}`,
      body: `${(r.areaDescription ?? '').slice(0, 200)} (source: ${r.source.replace('_', ' ')})`,
      severity: r.severity,
      data: { hazardId: r.id },
    });
  }
  if (rows.length) emit(['broadcast'], 'hazard:updated', { count: rows.length });
}

function isActive(e, now, windowMs) {
  if (e.expiresAt) return new Date(e.expiresAt) > now;
  return now - new Date(e.startsAt) < windowMs;
}

export async function listHazards(q) {
  const now = new Date();
  const windowMs = q.sinceHours * 3600 * 1000;
  const rows = await prisma.hazardFeedEvent.findMany({
    where: {
      startsAt: { gte: new Date(now - Math.max(windowMs, 45 * 86400000)) },
      ...(q.source ? { source: q.source } : {}),
      ...(q.type ? { hazardType: { in: q.type } } : {}),
    },
    orderBy: { startsAt: 'desc' },
    take: 500,
  });
  let items = rows
    .filter((e) => (q.activeOnly ? isActive(e, now, windowMs) : now - new Date(e.startsAt) < windowMs || (e.expiresAt && new Date(e.expiresAt) > now)))
    .filter((e) => !q.minSeverity || severityRank(e.severity) >= severityRank(q.minSeverity))
    .map(publicHazard);
  if (q.latitude != null) {
    items = items
      .map((e) => ({ ...e, distanceKm: e.latitude != null ? haversineKm(q.latitude, q.longitude, e.latitude, e.longitude) : null }))
      .filter((e) => e.distanceKm != null && e.distanceKm <= q.radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }
  return { items: items.slice(0, q.limit), total: items.length };
}

export async function feedStatus() {
  const statuses = await prisma.hazardFeedStatus.findMany();
  return FEEDS.map((f) => {
    const s = statuses.find((x) => x.source === f.source);
    return {
      source: f.source,
      label: f.label,
      lastAttemptAt: s?.lastAttemptAt ?? null,
      lastSuccessAt: s?.lastSuccessAt ?? null,
      lastError: s?.lastError ?? null,
      lastCount: s?.lastCount ?? 0,
      healthy: Boolean(s?.lastSuccessAt && (!s.lastError || s.lastSuccessAt >= s.lastAttemptAt)),
    };
  });
}

const ZONE_TYPE = { EARTHQUAKE: 'EARTHQUAKE', FLOOD: 'FLOOD', CYCLONE: 'CYCLONE', LANDSLIDE: 'LANDSLIDE', WILDFIRE: 'WILDFIRE', HEATWAVE: 'HEATWAVE', DROUGHT: 'DROUGHT' };
const DEFAULT_RADIUS = { EARTHQUAKE: 50, FLOOD: 30, CYCLONE: 120, TSUNAMI: 30, LANDSLIDE: 10 };

// A coordinator turns a feed event into a DisplaceOS disaster zone (with the feed as its source).
export async function createZone(user, id, { radiusKm, name }, req) {
  const e = await prisma.hazardFeedEvent.findUnique({ where: { id } });
  if (!e) throw notFound('Hazard event');
  if (e.disasterZoneId) throw conflict('A disaster zone was already created from this event');
  if (e.latitude == null) throw badRequest('This alert has no map position. Create the zone manually from Administration and enter its centre.');
  const zone = await prisma.$transaction(async (tx) => {
    const z = await tx.disasterZone.create({
      data: {
        name: (name ?? `${e.title}${e.state ? ` — ${e.state}` : ''}`).slice(0, 120),
        hazardType: ZONE_TYPE[e.hazardType] ?? 'OTHER',
        description: e.areaDescription,
        status: 'ACTIVE',
        severity: severityRank(e.severity) >= severityRank('HIGH') ? e.severity : 'HIGH',
        centerLat: e.latitude,
        centerLng: e.longitude,
        radiusKm: radiusKm ?? DEFAULT_RADIUS[e.hazardType] ?? 20,
        source: `${e.source.replace('_', ' ')} live feed`,
        sourceUrl: e.sourceUrl,
        isVerified: e.isOfficial,
        createdById: user.id,
      },
    });
    await tx.hazardFeedEvent.update({ where: { id }, data: { disasterZoneId: z.id } });
    await audit(tx, { actor: user, action: 'DISASTER_ZONE_FROM_FEED', entityType: 'DisasterZone', entityId: z.id, after: { hazardId: id, source: e.source }, req });
    return z;
  });
  emit(['broadcast'], 'zone:updated', { id: zone.id, status: zone.status });
  return zone;
}
