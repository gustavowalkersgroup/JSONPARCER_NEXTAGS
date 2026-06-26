import { expect, test } from 'vitest';
import { tokenize } from '../../src/parser/tokenizer';

test('tokenizes object with string and number', () => {
  const t = tokenize('{"a":4}');
  expect(t.map((x) => x.kind)).toEqual(['lbrace', 'string', 'colon', 'number', 'rbrace']);
  expect(t[1]?.value).toBe('a');
  expect(t[3]?.value).toBe(4);
});

test('accepts single-quoted strings', () => {
  expect(tokenize("{'a':1}")[1]?.value).toBe('a');
});

test('decodes escapes including newline', () => {
  expect(tokenize('"a\\nb"')[0]?.value).toBe('a\nb');
});

test('handles truncated string at EOF', () => {
  expect(tokenize('"oi')[0]?.value).toBe('oi');
});
