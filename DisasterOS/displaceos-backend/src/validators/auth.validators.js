import { z } from 'zod';
import { RoleEnum, listQuery, uuid, text } from './common.js';

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');
const phone = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number');

// `role` is intentionally absent: public registration can only create CITIZEN accounts.
// Unknown keys are stripped, so a client-supplied role is silently ignored.
export const registerBody = z.object({
  email,
  password,
  fullName: text(120, 2),
  phone: phone.optional(),
  tokenDelivery: z.enum(['cookie', 'body']).default('cookie'),
});

export const loginBody = z.object({
  email,
  password: z.string().min(1).max(128),
  tokenDelivery: z.enum(['cookie', 'body']).default('cookie'),
});

export const refreshBody = z.object({
  refreshToken: z.string().min(20).max(200).optional(),
  tokenDelivery: z.enum(['cookie', 'body']).default('cookie'),
});

export const updateMeBody = z
  .object({ fullName: text(120, 2).optional(), phone: phone.nullable().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export const listUsersQuery = listQuery(['createdAt'], {
  role: RoleEnum.optional(),
  search: z.string().trim().max(100).optional(),
});

export const changeRoleBody = z
  .object({
    role: RoleEnum,
    locationIds: z.array(uuid).max(50).optional(),
    isActive: z.boolean().optional(),
    reason: text(500, 3),
  })
  .strict();
