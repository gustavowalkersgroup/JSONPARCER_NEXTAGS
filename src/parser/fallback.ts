import { jsonrepair } from 'jsonrepair';
import type { Diagnostic, ResolvedOptions } from '../types';
import { Codes, diag, IrrecoverableError } from '../errors';
import { extract } from './extract';
import { repairText } from './repair';
import { tokenize } from './tokenizer';
import { parseTokens } from './parser';

// Orquestra a recuperação híbrida: extract → repair → parse estrito →
// parser tolerante próprio → fallback jsonrepair. Lança IrrecoverableError se
// nada recuperar.
export function parseRecover(
  raw: string,
  opts: ResolvedOptions,
): { value: unknown; repairs: Diagnostic[] } {
  const repairs: Diagnostic[] = [];

  const ex = extract(raw);
  repairs.push(...ex.repairs);
  const rep = repairText(ex.text);
  repairs.push(...rep.repairs);

  // 1. Tentativa estrita (rápida, caminho feliz). Só aceita objeto/array —
  // um primitivo (string/número) não é um payload utilizável.
  try {
    const value = JSON.parse(rep.text);
    if (value && typeof value === 'object') return { value, repairs };
  } catch {
    /* segue */
  }

  // 2. Parser tolerante próprio.
  try {
    const r = parseTokens(tokenize(rep.text));
    if (r.value && typeof r.value === 'object') {
      return { value: r.value, repairs: [...repairs, ...r.repairs] };
    }
  } catch {
    /* segue */
  }

  // 3. Fallback de biblioteca. jsonrepair é agressivo e pode envolver lixo
  // como string — só aceita resultado objeto/array.
  if (opts.parser.useFallbackLibrary) {
    try {
      const value = JSON.parse(jsonrepair(rep.text));
      if (value && typeof value === 'object') {
        repairs.push(diag(Codes.REPAIR_FALLBACK_LIB, 'Recuperado via jsonrepair'));
        return { value, repairs };
      }
    } catch {
      /* segue */
    }
  }

  throw new IrrecoverableError('JSON irrecuperável', Codes.ERR_IRRECOVERABLE_JSON, { raw });
}
