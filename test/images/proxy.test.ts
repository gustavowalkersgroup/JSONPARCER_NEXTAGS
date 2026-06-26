import { expect, test } from 'vitest';
import { normalizeUrl, proxyUrl, rewriteImages } from '../../src/images/proxy';
import { resolveOptions } from '../../src/config/resolve';

test('strips query string', () => {
  expect(normalizeUrl('https://x/a.webp.jpg?v=1', resolveOptions()).url).toBe('https://x/a.webp.jpg');
});

test('proxy rewrites image url with normalized url', () => {
  const o = resolveOptions({ image: { proxyBase: 'https://p/cf-img-proxy' } });
  const r = rewriteImages(
    { messages: [{ message: { attachment: { type: 'image', payload: { url: 'https://x/a.jpg?v=1' } } } }] },
    o,
  );
  const url = (r.payload.messages![0] as { message: { attachment: { payload: { url: string } } } })
    .message.attachment.payload.url;
  expect(url).toBe('https://p/cf-img-proxy?u=' + encodeURIComponent('https://x/a.jpg'));
});

test('detect-only without proxy removes unverifiable webp image', () => {
  const o = resolveOptions({ image: { strategy: 'detect-only' } });
  const r = rewriteImages(
    { messages: [{ message: { attachment: { type: 'image', payload: { url: 'https://x/a.webp' } } } }] },
    o,
  );
  expect((r.payload.messages![0] as { message: { attachment?: unknown } }).message.attachment).toBeUndefined();
  expect(r.diagnostics.some((d) => d.code === 'PENDING_IMAGE_UNVERIFIABLE')).toBe(true);
});

test('proxyUrl encodes the target url', () => {
  expect(proxyUrl('https://p', 'https://x/a b.jpg')).toBe('https://p?u=' + encodeURIComponent('https://x/a b.jpg'));
});
