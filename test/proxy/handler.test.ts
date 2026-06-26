import { expect, test } from 'vitest';
import { createProxyHandler } from '../../src/proxy/handler';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = (() => {
  const b = new Uint8Array(12);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  return b;
})();

test('returns non-webp candidate without transcoding', async () => {
  const h = createProxyHandler({
    fetchImpl: async (u) => (u.includes('format=jpg') ? PNG : WEBP),
    transcode: async () => {
      throw new Error('should not transcode');
    },
  });
  const r = await h('https://x/a.jpg');
  expect(r.contentType).toBe('image/png');
});

test('transcodes when all candidates are webp', async () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const h = createProxyHandler({
    fetchImpl: async () => WEBP,
    transcode: async () => JPEG,
  });
  const r = await h('https://x/a.jpg');
  expect(r.contentType).toBe('image/jpeg');
  expect(r.body[0]).toBe(0xff);
});
