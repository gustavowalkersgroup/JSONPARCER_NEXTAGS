import { expect, test } from 'vitest';
import { resolveOptions } from '../src/config/resolve';

test('applies defaults and deep-merges', () => {
  const o = resolveOptions({ delays: { interProduct: 9 } });
  expect(o.delays.intraCard).toBe(4);
  expect(o.delays.interProduct).toBe(9);
  expect(o.image.strategy).toBe('proxy');
  expect(o.fallback.message).toContain('instante');
});

test('handoff null default is preserved', () => {
  expect(resolveOptions().fallback.handoff).toBeNull();
});
