import { expect, test } from 'vitest';
import { process } from '../../src/core/pipeline';
import type { MessageItem } from '../../src/types';

const EXAMPLE = JSON.stringify({
  messages: [
    { message: { text: 'Boa escolha! clique 👇' } },
    {
      message: {
        attachment: {
          type: 'image',
          payload: { url: 'https://cdn.shopify.com/s/files/x/Unitario_OSA_1024x.webp.jpg?v=1778503411' },
        },
      },
    },
    {
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: 'Vitamina OSA',
            buttons: [{ type: 'web_url', title: 'Comprar', url: 'https://x?discount=ANALOVER10' }],
          },
        },
      },
    },
    { message: { text: 'Cupom já aplicado 😉' } },
  ],
});

const findImageUrl = (ms: MessageItem[]): string => {
  const m = ms.find((x) => typeof x !== 'number' && x.message.attachment?.type === 'image');
  if (!m || typeof m === 'number') throw new Error('imagem não encontrada');
  return m.message.attachment!.payload.url as string;
};

test('processes the real example: proxy + delays, no leak', () => {
  const r = process(EXAMPLE, { image: { proxyBase: 'https://p/cf-img-proxy' } });
  expect(r.ok).toBe(true);
  const ms = r.data!.messages!;
  expect(typeof ms[1]).toBe('number'); // delay inserido após o texto de intro
  const imgUrl = findImageUrl(ms);
  expect(imgUrl.startsWith('https://p/cf-img-proxy?u=')).toBe(true);
  expect(imgUrl).not.toContain('?v='); // query removida antes do encode
});

test('irrecoverable → fallback message + handoff, ok=false', () => {
  const r = process('lixo total ????', {
    fallback: { message: 'Já te respondo', handoff: { action: 'send_flow', flow_id: '123' } },
  });
  expect(r.ok).toBe(false);
  expect((r.data!.messages![0] as { message: { text: string } }).message.text).toBe('Já te respondo');
  expect(r.data!.actions![0]).toEqual({ action: 'send_flow', flow_id: '123' });
});

test('simulation produced when requested', () => {
  const r = process(EXAMPLE, { image: { proxyBase: 'https://p' }, simulate: true });
  expect(r.simulation).toBeDefined();
  expect(r.simulation!.stats.productCount).toBe(1);
});
