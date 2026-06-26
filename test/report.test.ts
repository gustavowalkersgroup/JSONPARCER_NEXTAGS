import { expect, test } from 'vitest';
import { createReport } from '../src/report/report';
import { Codes, diag } from '../src/errors';

test('routes diagnostics by code prefix', () => {
  const r = createReport();
  r.push(diag(Codes.REPAIR_FENCE_STRIPPED, 'x'));
  r.push(diag(Codes.WARN_BLOCK_AMBIGUOUS, 'y'));
  r.push(diag(Codes.PENDING_IMAGE_UNVERIFIABLE, 'z'));
  r.push(diag(Codes.ERR_ROOT_EMPTY, 'w'));
  expect(r.repairs.length).toBe(1);
  expect(r.warnings.length).toBe(1);
  expect(r.pending.length).toBe(1);
  expect(r.errors.length).toBe(1);
});
