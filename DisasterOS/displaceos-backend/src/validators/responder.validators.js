// Validators for responder organisations, team offers and supply donations.
import { z } from 'zod';
import { email, password, phone } from './auth.validators.js';
import { CategoryEnum, boolQuery, latitude, listQuery, longitude, queryLat, queryLng, reason, text, uuid } from './common.js';

const account = z.object({ fullName: text(120, 2), email, password, phone: phone.optional() }).strict();
const tokenDelivery = z.enum(['cookie', 'body']).default('cookie');

export const OrganizationTypeEnum = z.enum(['NGO', 'GOVERNMENT', 'VOLUNTEER_GROUP', 'MEDICAL', 'PRIVATE_COMPANY', 'OTHER']);

export const registerOrgBody = z
  .object({
    organization: z
      .object({
        name: text(120, 3),
        type: OrganizationTypeEnum,
        area: text(160, 2),
        description: text(1000).optional(),
        contactPhone: phone,
      })
      .strict(),
    account,
    tokenDelivery,
  });
// Like citizen registration, unknown keys (e.g. a client-supplied `role`) are stripped, never applied.

export const joinOrgBody = z.object({ joinCode: z.string().trim().min(8).max(12), account, tokenDelivery });

export const listOrgsQuery = listQuery(['createdAt'], { status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional() });
export const approveOrgBody = z.object({ note: text(500).optional() }).strict();
export const memberDecisionBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']) }).strict();

export const openNeedsQuery = z
  .object({ latitude: queryLat.optional(), longitude: queryLng.optional(), category: CategoryEnum.optional() })
  .refine((v) => (v.latitude == null) === (v.longitude == null), { message: 'Provide both latitude and longitude', path: ['latitude'] });
export const createOfferBody = z.object({ teamId: uuid, note: text(500).optional(), ownSupplies: z.boolean().optional() }).strict();

const supplyLine = z
  .object({
    inventoryItemId: uuid.optional(),
    name: text(120).optional(),
    unit: text(30).optional(),
    quantity: z.number().int().positive().max(1_000_000),
  })
  .strict();

export const createSupplyBody = z
  .object({
    donorName: text(120, 2).optional(),
    deliveryMode: z.enum(['PICKUP', 'DROP_OFF']),
    pickupAddress: text(300).optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    availableFrom: z.string().datetime({ offset: true }).optional(),
    notes: text(1000).optional(),
    lines: z.array(supplyLine).min(1).max(20),
  })
  .strict()
  .refine((v) => (v.latitude == null) === (v.longitude == null), { message: 'Provide both latitude and longitude, or neither', path: ['latitude'] });

export const listSupplyQuery = listQuery(['createdAt'], {
  status: z.enum(['PENDING', 'ACCEPTED', 'RECEIVED', 'REJECTED', 'CANCELLED']).optional(),
  mine: boolQuery,
});
export const acceptSupplyBody = z
  .object({
    receivingLocationId: uuid,
    note: text(500).optional(),
    lines: z.array(z.object({ lineId: uuid, inventoryItemId: uuid }).strict()).max(20).optional(),
  })
  .strict();
export const receiveSupplyBody = z
  .object({ lines: z.array(z.object({ lineId: uuid, receivedQuantity: z.number().int().min(0).max(1_000_000) }).strict()).min(1).max(20), note: text(500).optional() })
  .strict();
export const supplyReasonBody = z.object({ reason }).strict();
