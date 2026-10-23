import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// 256-bit URL-safe random token.
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

// Human-friendly request reference like "DR-7K3F9Q". Ambiguous characters (0/O, 1/I) are excluded.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function referenceCode() {
  const bytes = randomBytes(6);
  let code = '';
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return `DR-${code}`;
}
