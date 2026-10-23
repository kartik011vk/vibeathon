import { badRequest } from '../utils/errors.js';

function toDetails(error, location) {
  return error.issues.map((i) => ({ location, path: i.path.join('.'), message: i.message }));
}

// Validates body, query and params with Zod schemas and stores the parsed values on req.valid.
export function validate({ body, query, params } = {}) {
  return (req, res, next) => {
    req.valid = req.valid ?? {};
    const parts = [
      ['params', params, req.params],
      ['query', query, req.query],
      ['body', body, req.body ?? {}],
    ];
    const details = [];
    for (const [location, schema, input] of parts) {
      if (!schema) continue;
      const result = schema.safeParse(input);
      if (result.success) req.valid[location] = result.data;
      else details.push(...toDetails(result.error, location));
    }
    if (details.length) return next(badRequest('Some fields are missing or invalid', details));
    next();
  };
}
