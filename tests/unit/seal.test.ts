import { describe, expect, it } from 'vitest';
import { seal, unseal } from '../../server/seal.ts';

const creds = { url: 'https://cloud.example.com/dav', username: 'me', password: 'app-pass 🔑' };

describe('seal', () => {
  it('round-trips', () => {
    expect(unseal(seal(creds))).toMatchObject(creds);
  });
  it('does not expose credentials in the token', () => {
    const t = seal(creds);
    expect(t).not.toContain('app-pass');
    expect(Buffer.from(t, 'base64url').toString('latin1')).not.toContain('me');
  });
  it('rejects tampering, garbage and expiry', () => {
    const t = seal(creds);
    const raw = Buffer.from(t, 'base64url');
    raw[raw.length - 1] ^= 1;
    expect(unseal(raw.toString('base64url'))).toBeNull();
    expect(unseal('nope')).toBeNull();
    expect(unseal(undefined)).toBeNull();
    expect(unseal(seal(creds, Date.now() - 31 * 24 * 3600 * 1000))).toBeNull();
  });
});
