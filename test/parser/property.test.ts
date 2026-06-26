import { expect, test } from 'vitest';
import fc from 'fast-check';
import { process } from '../../src/index';

test('process nunca lança e sempre devolve data, para qualquer string', () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      const r = process(s);
      expect(typeof r.ok).toBe('boolean');
      expect(r.data).toBeDefined();
    }),
    { numRuns: 500 },
  );
});

test('JSON válido corrompido por truncamento recupera ou cai em fallback limpo', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 40 }), (cut) => {
      const valid = JSON.stringify({
        messages: [{ message: { text: 'mensagem de teste do agente' } }],
      });
      const truncated = valid.slice(0, Math.max(1, valid.length - cut));
      const r = process(truncated);
      expect(r.data).toBeDefined();
      // O campo do cliente nunca contém diagnóstico.
      expect(JSON.stringify(r.data)).not.toContain('"repairs"');
    }),
  );
});
