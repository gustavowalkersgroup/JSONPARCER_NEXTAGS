import type { ResolvedOptions } from '../types';

// Normaliza a URL removendo a query string (`...a.webp.jpg?v=123` → `...a.webp.jpg`).
export function normalizeUrl(
  url: string,
  opts: ResolvedOptions,
): { url: string; changed: boolean } {
  if (!opts.image.stripQuery) return { url, changed: false };
  const stripped = url.split('?')[0] ?? url;
  return { url: stripped, changed: stripped !== url };
}

const BAD_EXT = /\.(webp|avif|svg|gif|bmp|tiff?|heic|heif)(\.|$)/i;

// Heurística offline da "regra de ouro": uma imagem é não-garantível quando a
// extensão indica formato proibido (inclui `.webp.jpg`) ou não é JPEG/PNG claro.
export function looksUnverifiable(url: string): boolean {
  const path = (url.split('?')[0] ?? url).toLowerCase();
  if (BAD_EXT.test(path)) return true;
  return !/\.(jpe?g|png)$/.test(path);
}
