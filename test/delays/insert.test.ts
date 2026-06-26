import { expect, test } from 'vitest';
import { insertDelays } from '../../src/delays/insert';
import { resolveOptions } from '../../src/config/resolve';
import type { MessageItem } from '../../src/types';

const img = (): MessageItem => ({
  message: { attachment: { type: 'image', payload: { url: 'u' } } },
});
const tmpl = (): MessageItem => ({
  message: { attachment: { type: 'template', payload: { template_type: 'button', text: 't' } } },
});
const txt = (): MessageItem => ({ message: { text: 'a' } });

const kinds = (ms: MessageItem[]): (string | number)[] =>
  ms.map((m) =>
    typeof m === 'number' ? m : m.message.attachment ? m.message.attachment.type : 'text',
  );

test('single product with surrounding text → 4/4/4', () => {
  const r = insertDelays([txt(), img(), tmpl(), txt()], resolveOptions());
  expect(kinds(r.messages)).toEqual(['text', 4, 'image', 4, 'template', 4, 'text']);
});

test('two products → interProduct 7 before second image', () => {
  const r = insertDelays([img(), tmpl(), img(), tmpl()], resolveOptions());
  expect(kinds(r.messages)).toEqual(['image', 4, 'template', 7, 'image', 4, 'template']);
});

test('idempotent: existing delays removed then reinserted', () => {
  const r = insertDelays([img(), 99, tmpl()], resolveOptions());
  expect(kinds(r.messages)).toEqual(['image', 4, 'template']);
});

test('respects per-transition override', () => {
  const r = insertDelays(
    [img(), tmpl(), img(), tmpl()],
    resolveOptions({ delays: { perTransition: { interProduct: 12 } } }),
  );
  expect(kinds(r.messages)).toEqual(['image', 4, 'template', 12, 'image', 4, 'template']);
});
