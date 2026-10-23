// Validators for alerts, inventory, allocations, teams, dispatches, locations, zones, notifications and dashboards.
import { z } from 'zod';
import {
  CategoryEnum,
  DispatchStatusEnum,
  LocationTypeEnum,
  SeverityEnum,
  boolQuery,
  csvEnum,
  latitude,
  listQuery,
  longitude,
  queryLat,
  queryLng,
  reason,
  text,
  uuid,
} from './common.js';

// Alerts
export const createAlertBody = z
  .object({
    title: text(160, 3),
    message: text(2000, 3),
    severity: SeverityEnum,
    requestId: uuid.optional(),
    disasterZoneId: uuid.optional(),
    source: text(80).optional(),
  })
  .strict();
export const listAlertsQuery = listQuery(['createdAt', 'updatedAt', 'severity'], {
  status: z.enum(['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
  severity: SeverityEnum.optional(),
  requestId: uuid.optional(),
  disasterZoneId: uuid.optional(),
});
export const ackBody = z.object({ note: text(500).optional() }).strict();
export const alertEscalateBody = z.object({ severity: SeverityEnum, reason }).strict();
export const resolveBody = z.object({ note: text(1000, 3) }).strict();

// Inventory
export const createItemBody = z
  .object({
    sku: z.string().trim().regex(/^[A-Z0-9-]{3,40}$/, 'SKU: 3-40 uppercase letters, digits or dashes'),
    name: text(120, 2),
    category: CategoryEnum,
    unit: text(30),
    description: text(500).optional(),
    lowStockThreshold: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();
export const updateItemBody = z
  .object({
    name: text(120, 2).optional(),
    unit: text(30).optional(),
    description: text(500).nullable().optional(),
    lowStockThreshold: z.number().int().min(0).max(1_000_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const listItemsQuery = listQuery(['name'], {
  category: CategoryEnum.optional(),
  search: z.string().trim().max(100).optional(),
  includeInactive: boolQuery,
});
export const transactionBody = z
  .object({
    type: z.enum(['RECEIPT', 'ADJUSTMENT', 'CONSUMPTION']),
    itemId: uuid,
    locationId: uuid,
    quantity: z.number().int().min(-1_000_000).max(1_000_000),
    reason,
    requestId: uuid.optional(),
  })
  .strict();
export const listTransactionsQuery = listQuery(['createdAt'], {
  itemId: uuid.optional(),
  locationId: uuid.optional(),
  type: z.enum(['RECEIPT', 'ADJUSTMENT', 'RESERVATION', 'RELEASE', 'CONSUMPTION']).optional(),
});
export const availabilityQuery = z
  .object({
    itemId: uuid.optional(),
    category: CategoryEnum.optional(),
    locationId: uuid.optional(),
    locationType: LocationTypeEnum.optional(),
    latitude: queryLat.optional(),
    longitude: queryLng.optional(),
    radiusKm: z.coerce.number().positive().max(1000).optional(),
  })
  .refine((v) => (v.latitude == null) === (v.longitude == null), { message: 'Provide both latitude and longitude', path: ['latitude'] });

// Allocations
export const createAllocationBody = z
  .object({
    requestId: uuid,
    sourceLocationId: uuid,
    lines: z.array(z.object({ requestItemId: uuid, quantity: z.number().int().positive().max(1_000_000) }).strict()).min(1).max(20),
    notes: text(1000).optional(),
    rationale: z.array(text(300)).max(10).optional(),
  })
  .strict();
export const listAllocationsQuery = listQuery(['createdAt'], {
  status: z.enum(['PROPOSED', 'APPROVED', 'REJECTED', 'RELEASED', 'DISPATCHED', 'FULFILLED']).optional(),
  requestId: uuid.optional(),
  sourceLocationId: uuid.optional(),
});
export const suggestionsQuery = z.object({ requestId: uuid });

// Teams
export const createTeamBody = z
  .object({
    name: text(80, 2),
    callSign: text(30).optional(),
    baseLocationId: uuid.optional(),
    members: z.array(z.object({ userId: uuid, roleInTeam: text(60).optional() }).strict()).max(30).optional(),
  })
  .strict();
export const listTeamsQuery = z.object({ availability: z.enum(['AVAILABLE', 'BUSY', 'OFF_DUTY']).optional() });
export const availabilityBody = z.object({ availability: z.enum(['AVAILABLE', 'BUSY', 'OFF_DUTY']) }).strict();
export const coordsBody = z.object({ latitude, longitude, accuracyMeters: z.number().positive().max(100000).optional() }).strict();

// Dispatches
export const createDispatchBody = z.object({ allocationId: uuid, teamId: uuid, notes: text(1000).optional() }).strict();
export const listDispatchesQuery = listQuery(['createdAt', 'updatedAt'], {
  status: csvEnum(DispatchStatusEnum),
  teamId: uuid.optional(),
  requestId: uuid.optional(),
  active: boolQuery,
});
export const completeBody = z
  .object({
    lines: z.array(z.object({ dispatchLineId: uuid, quantity: z.number().int().min(0).max(1_000_000) }).strict()).max(20).default([]),
    notes: text(1000).optional(),
    final: z.boolean().default(false),
    // Responder's phone position at hand-over, used to verify the delivery point.
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    accuracyMeters: z.number().positive().max(100000).optional(),
  })
  .strict()
  .refine((v) => (v.latitude == null) === (v.longitude == null), { message: 'Provide both latitude and longitude, or neither', path: ['latitude'] });
export const failBody = z.object({ reason }).strict();
// `eta: null` records an explicit "ETA unavailable" state with a reason.
export const etaBody = z
  .object({ eta: z.string().datetime({ offset: true }).nullable(), reason })
  .strict()
  .refine((v) => v.eta == null || new Date(v.eta).getTime() > Date.now() - 60_000, { message: 'ETA must be in the future', path: ['eta'] })
  .refine((v) => v.eta == null || new Date(v.eta).getTime() < Date.now() + 14 * 86400000, { message: 'ETA must be within 14 days', path: ['eta'] });

// Locations, zones, maps
export const createLocationBody = z
  .object({
    name: text(120, 2),
    type: LocationTypeEnum,
    address: text(300).optional(),
    area: text(120).optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    contactInfo: text(200).optional(),
    disasterZoneId: uuid.optional(),
  })
  .strict()
  .refine((v) => (v.latitude == null) === (v.longitude == null), { message: 'Provide both latitude and longitude, or neither', path: ['latitude'] });
export const listLocationsQuery = z.object({ type: csvEnum(LocationTypeEnum), search: z.string().trim().max(100).optional() });
export const createZoneBody = z
  .object({
    name: text(120, 2),
    hazardType: z.enum(['FLOOD', 'EARTHQUAKE', 'CYCLONE', 'LANDSLIDE', 'WILDFIRE', 'HEATWAVE', 'DROUGHT', 'CONFLICT', 'OTHER']),
    description: text(2000).optional(),
    status: z.enum(['ACTIVE', 'MONITORING', 'CLOSED']).default('ACTIVE'),
    severity: SeverityEnum.default('HIGH'),
    centerLat: latitude.optional(),
    centerLng: longitude.optional(),
    radiusKm: z.number().positive().max(2000).optional(),
    source: text(160, 2),
    sourceUrl: z.string().url().max(500).optional(),
    isVerified: z.boolean().default(false),
  })
  .strict()
  .refine((v) => (v.centerLat == null) === (v.centerLng == null), { message: 'Provide both centre coordinates, or neither', path: ['centerLat'] });
export const updateZoneBody = z
  .object({
    status: z.enum(['ACTIVE', 'MONITORING', 'CLOSED']).optional(),
    severity: SeverityEnum.optional(),
    description: text(2000).optional(),
    radiusKm: z.number().positive().max(2000).optional(),
    isVerified: z.boolean().optional(),
    source: text(160, 2).optional(),
    sourceUrl: z.string().url().max(500).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');
export const listZonesQuery = z.object({ status: csvEnum(z.enum(['ACTIVE', 'MONITORING', 'CLOSED'])) });
export const mapResourcesQuery = z.object({ type: csvEnum(LocationTypeEnum), category: CategoryEnum.optional() });
export const mapRequestsQuery = z.object({
  status: csvEnum(z.enum(['SUBMITTED', 'VERIFIED', 'REJECTED', 'ALLOCATED', 'DISPATCHED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED'])),
  severity: csvEnum(SeverityEnum),
});
export const routeEstimateQuery = z.object({ fromLat: queryLat, fromLng: queryLng, toLat: queryLat, toLng: queryLng });

// Notifications and rules
export const listNotificationsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: boolQuery,
});
export const preferencesBody = z
  .object({
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
    minSeverity: SeverityEnum.optional(),
    mutedTypes: z.array(z.string().regex(/^[A-Z_]{3,40}$/)).max(30).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

const ruleConditions = z
  .object({
    categories: z.array(CategoryEnum).max(7).optional(),
    minPeopleAffected: z.number().int().min(1).optional(),
    minVulnerableCount: z.number().int().min(1).optional(),
    minTotalQuantity: z.number().int().min(1).optional(),
    inActiveZone: z.boolean().optional(),
    minZoneSeverity: SeverityEnum.optional(),
    minAgeMinutes: z.number().int().min(1).max(60 * 24 * 14).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'A rule needs at least one condition');
export const createRuleBody = z
  .object({
    name: text(120, 3),
    description: text(500).optional(),
    isActive: z.boolean().default(true),
    priority: z.number().int().min(0).max(1000).default(100),
    conditions: ruleConditions,
    resultingSeverity: SeverityEnum,
  })
  .strict();
export const updateRuleBody = z
  .object({
    name: text(120, 3).optional(),
    description: text(500).nullable().optional(),
    isActive: z.boolean().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    conditions: ruleConditions.optional(),
    resultingSeverity: SeverityEnum.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

// Dashboard, audit
export const responseTimesQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
export const auditQuery = listQuery(['createdAt'], {
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(60).optional(),
  actorId: uuid.optional(),
});
