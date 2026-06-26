import type { Attachment, Diagnostic, NexTagsPayload, ResolvedOptions, TemplateElement } from '../types';
import { Codes, diag } from '../errors';
import { normalizeUrl, looksUnverifiable } from './url';

export { normalizeUrl };

export function proxyUrl(base: string, url: string): string {
  return `${base}?u=${encodeURIComponent(url)}`;
}

// Reescreve URLs de imagem (attachment image e elements[].image_url). No modo
// `proxy` (com proxyBase), roteia pelo proxy de conversão; senão aplica a
// regra de ouro (remove o que não é garantidamente JPEG/PNG). Puro, sem I/O.
export function rewriteImages(
  payload: NexTagsPayload,
  opts: ResolvedOptions,
): { payload: NexTagsPayload; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const img = opts.image;

  const handleUrl = (url: string): { url?: string; remove?: boolean } => {
    const n = normalizeUrl(url, opts);
    if (n.changed) diagnostics.push(diag(Codes.REPAIR_URL_NORMALIZED, 'URL de imagem normalizada'));
    if (img.strategy === 'proxy' && img.proxyBase) {
      diagnostics.push(diag(Codes.REPAIR_IMAGE_PROXIED, 'URL de imagem roteada pelo proxy'));
      return { url: proxyUrl(img.proxyBase, n.url) };
    }
    if (looksUnverifiable(n.url) && img.removeUnverifiable) {
      diagnostics.push(diag(Codes.PENDING_IMAGE_UNVERIFIABLE, `Imagem não-garantível removida: ${n.url}`));
      return { remove: true };
    }
    return { url: n.url };
  };

  for (const item of payload.messages ?? []) {
    if (typeof item === 'number') continue;
    const att = item.message.attachment as Attachment | undefined;
    if (att?.type === 'image' && typeof att.payload.url === 'string') {
      const r = handleUrl(att.payload.url);
      if (r.remove) delete item.message.attachment;
      else att.payload.url = r.url;
    }
    const elements = att?.payload.elements as TemplateElement[] | undefined;
    for (const el of elements ?? []) {
      if (typeof el.image_url === 'string') {
        const r = handleUrl(el.image_url);
        if (r.remove) delete el.image_url;
        else el.image_url = r.url;
      }
    }
  }

  return { payload, diagnostics };
}
