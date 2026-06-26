import { expect, test } from 'vitest';
import { tokenize } from '../../src/parser/tokenizer';
import { parseTokens } from '../../src/parser/parser';

const p = (s: string) => parseTokens(tokenize(s));

test('parses valid object', () => {
  expect(p('{"a":[1,2]}').value).toEqual({ a: [1, 2] });
});

test('auto-closes truncated object', () => {
  const r = p('{"messages":[{"message":{"text":"oi"');
  expect((r.value as { messages: { message: { text: string } }[] }).messages[0]?.message.text).toBe(
    'oi',
  );
  expect(r.repairs.some((d) => d.code === 'REPAIR_AUTOCLOSED')).toBe(true);
});

test('inserts missing comma between members', () => {
  expect(p('{"a":1 "b":2}').value).toEqual({ a: 1, b: 2 });
});
