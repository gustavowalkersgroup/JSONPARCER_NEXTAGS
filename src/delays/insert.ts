import type { Diagnostic, MessageItem, ResolvedOptions, TransitionType } from '../types';
import { Codes, diag } from '../errors';
import { detectProducts } from './blocks';

// Inserção idempotente de delays. Remove delays existentes e reinsere por tipo
// de transição. Preserva a ordem original; nunca reassocia imagem↔template.
export function insertDelays(
  messages: MessageItem[],
  opts: ResolvedOptions,
): { messages: MessageItem[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const msgs = messages.filter((m) => typeof m !== 'number'); // remove delays existentes
  const { cardPairs, diagnostics: blockDiag } = detectProducts(msgs);
  diagnostics.push(...blockDiag);

  const d = opts.delays;
  const clamp = (n: number): number => Math.min(d.max, Math.max(d.min, n));
  const cardStart = new Set(cardPairs.map(([imgIdx]) => imgIdx)); // imagem que abre cada card
  const intraGap = new Set(cardPairs.map(([imgIdx]) => imgIdx)); // gap após a imagem = intraCard

  const out: MessageItem[] = [];
  let seenCard = false;
  for (let i = 0; i < msgs.length; i++) {
    if (i > 0) {
      let kind: TransitionType;
      if (intraGap.has(i - 1)) kind = 'intraCard'; // imagem(i-1) → template(i)
      else if (cardStart.has(i) && seenCard) kind = 'interProduct'; // antes da imagem de um novo produto
      else kind = 'default';
      const base =
        kind === 'intraCard' ? d.intraCard : kind === 'interProduct' ? d.interProduct : d.bubble;
      out.push(clamp(d.perTransition[kind] ?? base));
    }
    if (cardStart.has(i)) seenCard = true;
    out.push(msgs[i] as MessageItem);
  }

  if (msgs.length > 1) {
    diagnostics.push(diag(Codes.REPAIR_DELAYS_INSERTED, 'Delays inseridos/normalizados'));
  }
  return { messages: out, diagnostics };
}
