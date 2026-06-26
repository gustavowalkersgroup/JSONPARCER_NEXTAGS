import type { ResolvedOptions } from '../types';

export const DEFAULT_OPTIONS: ResolvedOptions = {
  image: { strategy: 'proxy', proxyBase: '', stripQuery: true, removeUnverifiable: true },
  delays: { intraCard: 4, interProduct: 7, bubble: 4, min: 1, max: 30, perTransition: {} },
  fallback: { message: 'Só um instante que já te respondo 😊', handoff: null },
  normalize: { stripStandardMarkdown: true, preserveWhatsappMarkup: true, straightenQuotes: true },
  parser: { useFallbackLibrary: true, maxRepairPasses: 3 },
  simulate: false,
  report: { level: 'warn' },
};
