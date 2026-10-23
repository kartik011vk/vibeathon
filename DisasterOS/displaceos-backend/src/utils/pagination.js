import { z } from 'zod';

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
};

// Builds Prisma skip/take/orderBy from validated query. `sortBy` must already be allow-listed by the validator.
export function pageArgs({ page, pageSize, sortBy = 'createdAt', sortOrder = 'desc' }) {
  return {
    skip: (page - 1) * pageSize,
    take: pageSize,
    orderBy: { [sortBy]: sortOrder },
  };
}

export function pageMeta({ page, pageSize }, total) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
