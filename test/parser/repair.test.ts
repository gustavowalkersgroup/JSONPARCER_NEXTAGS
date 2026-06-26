import { expect, test } from 'vitest';
import { repairText } from '../../src/parser/repair';

test('straightens smart quotes', () => {
  const r = repairText('{“messages”:[]}');
  expect(r.text).toBe('{"messages":[]}');
  expect(r.repairs.some((d) => d.code === 'REPAIR_SMART_QUOTES')).toBe(true);
});

test('removes trailing commas', () => {
  expect(repairText('{"a":[1,2,],}').text).toBe('{"a":[1,2]}');
});

test('does not touch commas inside strings', () => {
  expect(repairText('{"a":"x, y"}').text).toBe('{"a":"x, y"}');
});
