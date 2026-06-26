import type { Diagnostic } from '../types';
import { Codes, diag } from '../errors';

// Desencapsula a resposta do modelo: remove cerca markdown e prosa, isolando
// o objeto JSON externo por balanceamento de chaves (ignorando chaves dentro
// de strings).
export function extract(raw: string): { text: string; repairs: Diagnostic[] } {
  const repairs: Diagnostic[] = [];
  let s = raw.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) {
    s = fence[1].trim();
    repairs.push(diag(Codes.REPAIR_FENCE_STRIPPED, 'Removida cerca markdown'));
  }

  const start = s.indexOf('{');
  if (start === -1) return { text: s, repairs };

  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const text = end === -1 ? s.slice(start) : s.slice(start, end + 1);
  return { text, repairs };
}
