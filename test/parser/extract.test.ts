import { expect, test } from 'vitest';
import { extract } from '../../src/parser/extract';

test('strips json fence and surrounding prose', () => {
  const r = extract('Claro!\n```json\n{"messages":[]}\n```\nEspero ter ajudado.');
  expect(r.text).toBe('{"messages":[]}');
  expect(r.repairs.some((d) => d.code === 'REPAIR_FENCE_STRIPPED')).toBe(true);
});

test('isolates outermost object ignoring braces in strings', () => {
  expect(extract('{"messages":[{"message":{"text":"a } b"}}]}').text).toContain('a } b');
});

test('returns raw when no object found', () => {
  expect(extract('sem json').text).toBe('sem json');
});

test('keeps truncated object content from first brace', () => {
  expect(extract('blah {"messages":[{"message":{"text":"oi"').text).toBe(
    '{"messages":[{"message":{"text":"oi"',
  );
});
