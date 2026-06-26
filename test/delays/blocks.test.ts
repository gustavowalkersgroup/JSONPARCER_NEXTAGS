import { expect, test } from 'vitest';
import { detectProducts } from '../../src/delays/blocks';
import type { MessageItem } from '../../src/types';

const img = (): MessageItem => ({ message: { attachment: { type: 'image', payload: { url: 'u' } } } });
const tmpl = (): MessageItem => ({
  message: { attachment: { type: 'template', payload: { template_type: 'button', text: 't' } } },
});
const txt = (): MessageItem => ({ message: { text: 'a' } });

test('detects two product cards', () => {
  const r = detectProducts([txt(), img(), tmpl(), txt(), txt(), img(), tmpl()]);
  expect(r.cardPairs).toEqual([
    [1, 2],
    [5, 6],
  ]);
});

test('warns on orphan image', () => {
  const r = detectProducts([img(), txt()]);
  expect(r.diagnostics.some((d) => d.code === 'WARN_BLOCK_AMBIGUOUS')).toBe(true);
});
