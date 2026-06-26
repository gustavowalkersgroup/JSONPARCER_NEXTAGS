import type { Diagnostic, NexTagsPayload, ResolvedOptions } from '../types';
import { Codes, diag } from '../errors';

// Remove MARKDOWN-PADRÃO que vaza literal para o cliente, preservando o
// WA-markup (`*negrito*`, `_itálico_`, `~tachado~`) e emojis.
export function normalizeText(
  input: string,
  opts: ResolvedOptions,
): { text: string; changed: boolean } {
  if (!opts.normalize.stripStandardMarkdown) return { text: input, changed: false };
  let s = input;
  s = s.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1'); // links [txt](url) → txt
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1'); // **bold** → bold (antes do * único de WA)
  s = s.replace(/```[\s\S]*?```/g, ''); // blocos de código cercados
  s = s.replace(/`([^`]+)`/g, '$1'); // `code` inline → code
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, ''); // # H1..H6 (exige espaço; não pega hashtags)
  s = s.replace(/^\s{0,3}>\s?/gm, ''); // > blockquote
  s = s.replace(/^\s*[-*+]\s+/gm, ''); // bullets (- * +) — exige espaço; não pega *bold* WA
  s = s.replace(/[ \t]+\n/g, '\n').trim();
  return { text: s, changed: s !== input };
}

export function normalizePayloadText(
  payload: NexTagsPayload,
  opts: ResolvedOptions,
): { payload: NexTagsPayload; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const apply = (v: string | undefined): string | undefined => {
    if (typeof v !== 'string') return v;
    const r = normalizeText(v, opts);
    if (r.changed)
      diagnostics.push(diag(Codes.REPAIR_MARKDOWN_STRIPPED, 'Markdown-padrão removido'));
    return r.text;
  };

  for (const item of payload.messages ?? []) {
    if (typeof item === 'number') continue;
    const m = item.message;
    if (m.text !== undefined) m.text = apply(m.text);
    const p = m.attachment?.payload as
      | { text?: string; elements?: { title?: string; subtitle?: string }[] }
      | undefined;
    if (p?.text !== undefined) p.text = apply(p.text);
    for (const el of p?.elements ?? []) {
      if (el.title !== undefined) el.title = apply(el.title);
      if (el.subtitle !== undefined) el.subtitle = apply(el.subtitle);
    }
  }
  return { payload, diagnostics };
}
