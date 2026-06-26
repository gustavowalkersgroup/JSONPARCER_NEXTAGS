import type { Diagnostic, MessageItem } from '../types';
import { Codes, diag } from '../errors';
import { classifyItem } from './classify';

// Detecta cards de produto pela adjacência IMAGE→TEMPLATE (par protegido).
// Opera sobre a sequência só-mensagens; índices referem-se a essa sequência.
// Nunca reassocia nem reordena — ambiguidade vira warning.
export function detectProducts(messages: MessageItem[]): {
  cardPairs: Array<[number, number]>;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const onlyMsgs = messages.filter((m) => typeof m !== 'number');
  const kinds = onlyMsgs.map(classifyItem);
  const cardPairs: Array<[number, number]> = [];

  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === 'IMAGE') {
      if (kinds[i + 1] === 'TEMPLATE') {
        cardPairs.push([i, i + 1]);
        i++; // pula o template já pareado
      } else {
        diagnostics.push(
          diag(Codes.WARN_BLOCK_AMBIGUOUS, `Imagem órfã na posição ${i} (sem template em seguida)`),
        );
      }
    }
  }

  return { cardPairs, diagnostics };
}
