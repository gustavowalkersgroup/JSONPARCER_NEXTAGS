import type { Diagnostic } from '../types';
import { Codes, diag } from '../errors';

// Reparos de texto aplicados antes do parse: aspas tipográficas e vírgulas
// finais. Atua respeitando o conteúdo das strings.
export function repairText(input: string): { text: string; repairs: Diagnostic[] } {
  const repairs: Diagnostic[] = [];
  let s = input;

  if (/[“”‘’]/.test(s)) {
    s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    repairs.push(diag(Codes.REPAIR_SMART_QUOTES, 'Aspas tipográficas normalizadas'));
  }

  // Remove vírgula seguida (ignorando espaços) de } ou ] — fora de strings.
  let out = '';
  let inStr = false;
  let esc = false;
  let changed = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j] as string)) j++;
      if (s[j] === '}' || s[j] === ']') {
        changed = true;
        continue;
      }
    }
    out += c;
  }
  if (changed) repairs.push(diag(Codes.REPAIR_TRAILING_COMMA, 'Vírgula final removida'));

  return { text: out, repairs };
}
