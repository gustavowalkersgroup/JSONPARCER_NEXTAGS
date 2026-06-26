import { expect, test } from 'vitest';
import { validatePayload } from '../../src/schema/validate';

test('removes web_url button without url', () => {
  const r = validatePayload({
    messages: [
      {
        message: {
          attachment: {
            type: 'template',
            payload: { template_type: 'button', text: 't', buttons: [{ type: 'web_url', title: 'x' }] },
          },
        },
      },
    ],
  });
  const btns = (
    r.payload.messages![0] as {
      message: { attachment: { payload: { buttons: unknown[] } } };
    }
  ).message.attachment.payload.buttons;
  expect(btns.length).toBe(0);
  expect(r.diagnostics.some((d) => d.code === 'ERR_BUTTON_MISSING_FIELD')).toBe(true);
});

test('clamps typing indicator out of range', () => {
  const r = validatePayload({
    messages: [{ message: { text: 'a' } }, 99, { message: { text: 'b' } }],
  });
  expect(r.payload.messages![1]).toBe(30);
  expect(r.diagnostics.some((d) => d.code === 'REPAIR_TYPING_CLAMPED')).toBe(true);
});

test('flags carousel with <2 elements and removes it', () => {
  const r = validatePayload({
    messages: [
      {
        message: {
          attachment: {
            type: 'template',
            payload: { template_type: 'generic', elements: [{ title: 'só um' }] },
          },
        },
      },
    ],
  });
  expect(r.diagnostics.some((d) => d.code === 'ERR_CAROUSEL_TOO_SMALL')).toBe(true);
  expect(r.payload.messages!.length).toBe(0);
});

test('keeps valid button template intact', () => {
  const r = validatePayload({
    messages: [
      {
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text: 'Comprar agora',
              buttons: [{ type: 'web_url', title: 'Abrir', url: 'https://x' }],
            },
          },
        },
      },
    ],
  });
  expect(r.payload.messages!.length).toBe(1);
  expect(r.diagnostics.filter((d) => d.code.startsWith('ERR')).length).toBe(0);
});
