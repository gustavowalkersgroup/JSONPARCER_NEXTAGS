import { expect, test } from 'vitest';
import { process } from '../../src/core/pipeline';
import { toCardOutput } from '../../src/card/output';

test('client field carries only data; report goes to debug', () => {
  const r = process('{"messages":[{"message":{"text":"oi"}}]}');
  const out = toCardOutput(r, { clientField: 'resposta', debugField: '_debug' });
  expect(typeof out.resposta).toBe('string');
  expect(JSON.parse(out.resposta as string).messages[0].message.text).toBe('oi');
  expect(out.resposta).not.toContain('repairs'); // nenhum diagnóstico no campo do cliente
  expect((out._debug as { report: { stats: unknown } }).report.stats).toBeDefined();
});

test('uses default field names', () => {
  const r = process('{"messages":[{"message":{"text":"x"}}]}');
  const out = toCardOutput(r);
  expect(out.resposta).toBeDefined();
  expect(out._debug).toBeDefined();
});
