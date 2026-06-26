import { expect, test } from 'vitest';
import { parseRecover } from '../../src/parser/fallback';
import { resolveOptions } from '../../src/config/resolve';
import { IrrecoverableError } from '../../src/errors';

const o = resolveOptions();

test('recovers fenced + truncated', () => {
  const r = parseRecover('```json\n{"messages":[{"message":{"text":"oi"', o);
  expect((r.value as { messages: { message: { text: string } }[] }).messages[0]?.message.text).toBe(
    'oi',
  );
});

test('recovers trailing comma via strict path after repair', () => {
  const r = parseRecover('{"a":[1,2,],}', o);
  expect(r.value).toEqual({ a: [1, 2] });
});

test('throws on pure garbage', () => {
  expect(() => parseRecover('????', o)).toThrow(IrrecoverableError);
});
