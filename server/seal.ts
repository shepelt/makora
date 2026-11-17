// Sealed WebDAV credentials for requests that can't carry headers (<img>).
//
// The browser still owns the credentials: it sends them once to /api/seal and
// gets them back as an encrypted, HttpOnly cookie. The server stores nothing;
// it only decrypts the cookie per request. Rotating MAKORA_SECRET (or a
// restart without one) invalidates all seals; the client simply re-seals.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type SealedCreds = { url: string; username: string; password: string; exp: number };

const SECRET = process.env.MAKORA_SECRET
  ? createHash('sha256').update(process.env.MAKORA_SECRET).digest()
  : randomBytes(32);

export const SEAL_COOKIE = 'makora_dav';
export const SEAL_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function seal(creds: Omit<SealedCreds, 'exp'>, now = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', SECRET, iv);
  const body = Buffer.from(JSON.stringify({ ...creds, exp: now + SEAL_MAX_AGE * 1000 }));
  const enc = Buffer.concat([cipher.update(body), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

export function unseal(token: string | undefined, now = Date.now()): SealedCreds | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', SECRET, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const body = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    const creds = JSON.parse(body.toString('utf8')) as SealedCreds;
    if (!creds.exp || creds.exp < now) return null;
    return creds;
  } catch {
    return null;
  }
}
