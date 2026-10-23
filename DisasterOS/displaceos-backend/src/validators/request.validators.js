import { z } from 'zod';
import {
  CategoryEnum,
  RequestStatusEnum,
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

const item = z
  .object({
    inventoryItemId: uuid.optional(),
    name: text(120).optional(),
    unit: text(30).optional(),
    quantity: z.number().int().positive().max(1_000_000),
  })
  .strict();

const attachment = z
  .object({
    fileName: text(200),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    sizeBytes: z.number().int().positive().max(10 * 1024 * 1024),
    storageRef: text(500),
  })
  .strict();

// Clients cannot send severity, status, requesterId or zone: the server owns those.
export const createRequestBody = z
  .object({
    category: CategoryEnum,
    description: text(2000, 5),
    peopleAffected: z.number().int().min(1).max(1_000_000),
    vulnerableCount: z.number().int().min(0).max(1_000_000).optional(),
    items: z.array(item).min(1).max(20),
    campId: uuid.optional(),
    destinationAddress: text(300).optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    attachments: z.array(attachment).max(5).optional(),
  })
  .strict()
  .refine((v) => (v.latitude == null) === (v.longitude == null), { message: 'Provide both latitude and longitude, or neither', path: ['latitude'] })
  .refine((v) => v.vulnerableCount == null || v.vulnerableCount <= v.peopleAffected, { message: 'Vulnerable people cannot exceed people affected', path: ['vulnerableCount'] })
  .refine((v) => v.campId || v.destinationAddress || v.latitude != null, { message: 'Provide a camp, an address or a location', path: ['destinationAddress'] });

export const updateRequestBody = z
  .object({
    description: text(2000, 5).optional(),
    peopleAffected: z.number().int().min(1).max(1_000_000).optional(),
    vulnerableCount: z.number().int().min(0).max(1_000_000).nullable().optional(),
    destinationAddress: text(300).nullable().optional(),
    latitude: latitude.nullable().optional(),
    longitude: longitude.nullable().optional(),
    campId: uuid.nullable().optional(),
    disasterZoneId: uuid.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field')
  .refine((v) => ('latitude' in v) === ('longitude' in v), { message: 'Update latitude and longitude together', path: ['latitude'] });

export const listRequestsQuery = listQuery(['createdAt', 'updatedAt', 'severity', 'status'], {
  status: csvEnum(RequestStatusEnum),
  severity: csvEnum(SeverityEnum),
  category: CategoryEnum.optional(),
  campId: uuid.optional(),
  search: z.string().trim().max(100).optional(),
  mine: boolQuery,
  open: boolQuery,
});

export const verifyBody = z
  .object({ decision: z.enum(['VERIFY', 'REJECT']), reason, severity: SeverityEnum.optional() })
  .strict()
  .refine((v) => v.decision === 'VERIFY' || !v.severity, { message: 'Severity applies only when verifying', path: ['severity'] });

export const escalateBody = z.object({ severity: SeverityEnum.optional(), reason }).strict();

export const nearbyQuery = z.object({
  latitude: queryLat,
  longitude: queryLng,
  radiusKm: z.coerce.number().positive().max(500).default(25),
  open: boolQuery,
});

export const trackingTokenBody = z.object({ ttlHours: z.number().int().min(1).max(720).optional() }).strict();
