import { expect, test } from 'vitest';
import { Codes, IrrecoverableError } from '../src/errors';

test('codes are stable strings', () => {
  expect(Codes.ERR_IRRECOVERABLE_JSON).toBe('ERR_IRRECOVERABLE_JSON');
});

test('IrrecoverableError carries code', () => {
  const e = new IrrecoverableError('boom', 'ERR_IRRECOVERABLE_JSON');
  expect(e.code).toBe('ERR_IRRECOVERABLE_JSON');
  expect(e instanceof Error).toBe(true);
});
