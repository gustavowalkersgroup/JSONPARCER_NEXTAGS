import { expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const bundlePath = fileURLToPath(new URL('../dist/card.global.js', import.meta.url));

// Requer `npm run build` antes. Carrega o IIFE num contexto vm isolado e
// exercita a API. `code` é o nosso próprio artefato de build (confiável) —
// sem interpolação de entrada externa.
test.runIf(existsSync(bundlePath))('card bundle expõe WAMW e processa input', () => {
  const code = readFileSync(bundlePath, 'utf8');
  const context: Record<string, unknown> = { console };
  vm.createContext(context);
  vm.runInContext(code, context); // define `var WAMW` no global do contexto
  const WAMW = vm.runInContext('WAMW', context) as typeof import('../src/index');

  const out = WAMW.toCardOutput(WAMW.process('{"messages":[{"message":{"text":"oi"}}]}')) as {
    resposta: string;
  };
  expect(JSON.parse(out.resposta).messages[0].message.text).toBe('oi');
});
