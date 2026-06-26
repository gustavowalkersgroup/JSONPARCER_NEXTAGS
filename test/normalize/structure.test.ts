import { expect, test } from 'vitest';
import { coerceStructure } from '../../src/normalize/structure';

test('moves attachment.type out of payload', () => {
  const r = coerceStructure({
    messages: [{ message: { attachment: { payload: { type: 'image', url: 'u' } } } }],
  });
  const att = (
    r.value.messages![0] as {
      message: { attachment: { type: string; payload: Record<string, unknown> } };
    }
  ).message.attachment;
  expect(att.type).toBe('image');
  expect(att.payload.type).toBeUndefined();
  expect(r.diagnostics.some((d) => d.code === 'REPAIR_TYPE_MOVED_OUT_OF_PAYLOAD')).toBe(true);
});

test('empty root is fatal', () => {
  const r = coerceStructure({});
  expect(r.fatal).toBe(true);
  expect(r.diagnostics.some((d) => d.code === 'ERR_ROOT_EMPTY')).toBe(true);
});

test('actions-only payload is valid (not fatal)', () => {
  const r = coerceStructure({ actions: [{ action: 'send_flow', flow_id: '123' }] });
  expect(r.fatal).toBe(false);
  expect(r.value.actions?.length).toBe(1);
});
