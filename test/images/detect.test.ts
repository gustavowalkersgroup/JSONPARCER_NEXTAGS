import { expect, test } from 'vitest';
import { detectFormat, isWebp } from '../../src/images/detect';

test('detects jpeg/png/webp by magic bytes', () => {
  expect(detectFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
  expect(detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
    'png',
  );
  const webp = new Uint8Array(12);
  webp.set([0x52, 0x49, 0x46, 0x46], 0);
  webp.set([0x57, 0x45, 0x42, 0x50], 8);
  expect(detectFormat(webp)).toBe('webp');
  expect(isWebp(webp)).toBe(true);
});

test('unknown bytes are unknown', () => {
  expect(detectFormat(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe('unknown');
});
