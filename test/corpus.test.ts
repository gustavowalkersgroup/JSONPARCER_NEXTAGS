import { expect, test, describe } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { process } from '../src/index';

const dir = fileURLToPath(new URL('./fixtures/broken', import.meta.url));

describe('corpus de JSON quebrado', () => {
  for (const file of readdirSync(dir)) {
    test(`fixture ${file} sempre devolve um Result com data`, () => {
      const raw = readFileSync(`${dir}/${file}`, 'utf8');
      const r = process(raw);
      expect(typeof r.ok).toBe('boolean');
      expect(r.data).toBeDefined();
    });
  }

  test('fence e smart-quotes recuperam para ok=true', () => {
    expect(process(readFileSync(`${dir}/fence.txt`, 'utf8')).ok).toBe(true);
    expect(process(readFileSync(`${dir}/smart-quotes.txt`, 'utf8')).ok).toBe(true);
  });

  test('garbage cai no fallback ok=false', () => {
    expect(process(readFileSync(`${dir}/garbage.txt`, 'utf8')).ok).toBe(false);
  });
});
