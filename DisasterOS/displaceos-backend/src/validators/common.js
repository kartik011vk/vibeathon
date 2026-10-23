import { z } from 'zod';
import { paginationQuery } from '../utils/pagination.js';

export const uuid = z.string().uuid('Must be a valid id');
export const idParam = (name) => z.object({ [name]: uuid });

export const SeverityEnum = z.enum(['NORMAL', 'HIGH', 'RED', 'HYPER_RED']);
export const CategoryEnum = z.enum(['FOOD', 'WATER', 'MEDICINE', 'SHELTER', 'HYGIENE', 'CLOTHING', 'OTHER']);
export const RoleEnum = z.enum(['CITIZEN', 'CAMP_MANAGER', 'RELIEF_COORDINATOR', 'INVENTORY_MANAGER', 'RESPONSE_TEAM', 'ADMIN']);
export const LocationTypeEnum = z.enum(['CAMP', 'WAREHOUSE', 'DISTRIBUTION_POINT', 'SHELTER', 'MEDICAL_POINT', 'OTHER']);
export const RequestStatusEnum = z.enum(['SUBMITTED', 'VERIFIED', 'REJECTED', 'ALLOCATED', 'DISPATCHED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED']);
export const DispatchStatusEnum = z.enum(['CREATED', 'ASSIGNED', 'ACCEPTED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED', 'DELIVERED', 'FAILED', 'CANCELLED']);

export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);
export const queryLat = z.coerce.number().min(-90).max(90);
export const queryLng = z.coerce.number().min(-180).max(180);

export const text = (max, min = 1) => z.string().trim().min(min).max(max);
export const reason = text(500, 3);

// "A,B" or repeated params → array of enum values.
export const csvEnum = (schema) =>
  z.preprocess((v) => (v == null || v === '' ? undefined : Array.isArray(v) ? v : String(v).split(',')), z.array(schema).optional());

export const boolQuery = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : undefined), z.boolean().optional());

export const listQuery = (sortFields, extra = {}) =>
  z.object({
    ...paginationQuery,
    sortBy: z.enum(sortFields).default(sortFields[0]),
    ...extra,
  });

export const reasonBody = z.object({ reason }).strict();
