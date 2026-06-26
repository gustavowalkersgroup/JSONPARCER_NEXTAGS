import { expect, test } from 'vitest';
import type { NexTagsPayload } from '../src/types';

test('payload type accepts canonical shape', () => {
  const p: NexTagsPayload = {
    messages: [{ message: { text: 'oi' } }, 4],
    actions: [{ action: 'add_tag', tag_name: 'x' }],
  };
  expect(p.messages?.length).toBe(2);
});
