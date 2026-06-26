import { expect, test } from 'vitest';
import { normalizeText, normalizePayloadText } from '../../src/normalize/text';
import { resolveOptions } from '../../src/config/resolve';

const o = resolveOptions();

test('strips standard markdown but preserves WA-markup and emoji', () => {
  expect(normalizeText('**Oi** _ok_ 😉', o).text).toBe('Oi _ok_ 😉');
  expect(normalizeText('# Título', o).text).toBe('Título');
  expect(normalizeText('Veja [aqui](http://x)', o).text).toBe('Veja aqui');
  expect(normalizeText('- item', o).text).toBe('item');
});

test('preserves single-asterisk WA bold and tilde strike', () => {
  expect(normalizeText('*forte*', o).text).toBe('*forte*');
  expect(normalizeText('~tachado~', o).text).toBe('~tachado~');
});

test('does not strip hashtags without trailing space', () => {
  expect(normalizeText('promo #black', o).text).toBe('promo #black');
});

test('normalizePayloadText cleans text fields', () => {
  const r = normalizePayloadText({ messages: [{ message: { text: '**oi**' } }] }, o);
  expect((r.payload.messages![0] as { message: { text: string } }).message.text).toBe('oi');
  expect(r.diagnostics.some((d) => d.code === 'REPAIR_MARKDOWN_STRIPPED')).toBe(true);
});
