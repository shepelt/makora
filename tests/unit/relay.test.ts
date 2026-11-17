import { describe, expect, it } from 'vitest';
import { isPrivateAddress, joinTarget, parseTarget, relay, RelayError } from '../../server/relay.ts';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:192.168.1.1',
  ])('blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '125.132.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );

  it('treats non-IPs as unsafe', () => expect(isPrivateAddress('example.com')).toBe(true));
});

describe('parseTarget', () => {
  const bad = (url: string | undefined, status: number) => {
    try {
      parseTarget(url);
      throw new Error('expected failure');
    } catch (e) {
      expect(e).toBeInstanceOf(RelayError);
      expect((e as RelayError).status).toBe(status);
    }
  };
  it('rejects missing/invalid/non-http targets', () => {
    bad(undefined, 400);
    bad('not a url', 400);
    bad('file:///etc/passwd', 400);
    bad('ftp://example.com', 400);
  });
  it('rejects credentials in the URL', () => bad('https://u:p@example.com/dav', 400));
  it('rejects private literal IPs and local names', () => {
    bad('http://127.0.0.1:8080/dav', 403);
    bad('http://192.168.0.10/dav', 403);
    bad('http://[::1]/dav', 403);
    bad('http://localhost/dav', 403);
    bad('http://nas.local/dav', 403);
    bad('http://169.254.169.254/latest/meta-data', 403);
  });
  it('allows public hosts', () => {
    expect(parseTarget('https://cloud.example.com/remote.php/dav/files/me').host).toBe('cloud.example.com');
  });
  it('allows private targets only in test mode', () => {
    expect(parseTarget('http://localhost:4080/dav', { allowPrivate: true }).port).toBe('4080');
  });
});

describe('joinTarget', () => {
  const base = new URL('https://cloud.example.com/remote.php/dav/files/me/');
  it('joins paths under the base', () => {
    expect(joinTarget(base, '/Notes/log.md').toString()).toBe('https://cloud.example.com/remote.php/dav/files/me/Notes/log.md');
    expect(joinTarget(base, '/Notes/').toString()).toBe('https://cloud.example.com/remote.php/dav/files/me/Notes/');
  });
  it('keeps percent-encoding', () => {
    expect(joinTarget(base, '/%ED%95%9C%EA%B8%80.md').pathname).toBe('/remote.php/dav/files/me/%ED%95%9C%EA%B8%80.md');
  });
  it('refuses to escape the base', () => {
    expect(() => joinTarget(base, '/../../etc/passwd')).toThrow(RelayError);
    expect(() => joinTarget(base, '/a/./b')).toThrow(RelayError);
  });
});

describe('relay', () => {
  const req = (method: string, target: string) =>
    new Request('http://makora.test/api/dav/x.md', { method, headers: { 'x-dav-target': target } });

  it('rejects disallowed methods', async () => {
    await expect(relay(req('POST', 'https://example.com/dav'), '/x.md')).rejects.toMatchObject({ status: 405 });
  });

  it('blocks hostnames that resolve to private addresses at connect time', async () => {
    // localhost.localtest.me-style names resolve to 127.0.0.1; use a plain
    // hostname that resolves locally.
    await expect(relay(req('GET', 'http://localhost.'), '/x.md')).rejects.toMatchObject({ status: 403 });
  });
});
