import { expect, test } from 'vitest';
import { canonicalizeActions } from '../../src/schema/actions';

test('maps addTag to add_tag (repair)', () => {
  const r = canonicalizeActions([{ action: 'addTag', tag_name: 'x' }]);
  expect(r.actions[0]?.action).toBe('add_tag');
  expect(r.diagnostics.some((d) => d.code === 'REPAIR_ACTION_ALIAS')).toBe(true);
});

test('flags legacy Rotativo() as pending and removes it', () => {
  const r = canonicalizeActions([{ action: 'Rotativo()' }]);
  expect(r.actions.length).toBe(0);
  expect(r.diagnostics.some((d) => d.code === 'PENDING_LEGACY_ACTION')).toBe(true);
});

test('dirty admin_id is pending', () => {
  const r = canonicalizeActions([{ action: 'assign_conversation', admin_id: 'Estela.' }]);
  expect(r.diagnostics.some((d) => d.code === 'PENDING_DIRTY_ADMIN_ID')).toBe(true);
});

test('keeps canonical send_flow untouched', () => {
  const r = canonicalizeActions([{ action: 'send_flow', flow_id: '1775096402729' }]);
  expect(r.actions[0]?.action).toBe('send_flow');
  expect(r.diagnostics.length).toBe(0);
});
