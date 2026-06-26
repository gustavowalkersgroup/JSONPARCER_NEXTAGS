import { expect, test } from 'vitest';
import { classifyItems } from '../../src/delays/classify';

test('classifies items', () => {
  expect(
    classifyItems([
      { message: { text: 'a' } },
      4,
      { message: { attachment: { type: 'image', payload: { url: 'u' } } } },
      {
        message: {
          attachment: { type: 'template', payload: { template_type: 'button', text: 't' } },
        },
      },
    ]),
  ).toEqual(['TEXT', 'DELAY', 'IMAGE', 'TEMPLATE']);
});
