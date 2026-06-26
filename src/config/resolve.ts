import type { MiddlewareOptions, ResolvedOptions } from '../types';
import { DEFAULT_OPTIONS } from './defaults';

// Merge explícito com `??` — robusto sob `strict` (spread de props opcionais
// alargaria os tipos para `T | undefined`).
export function resolveOptions(o: MiddlewareOptions = {}): ResolvedOptions {
  const d = DEFAULT_OPTIONS;
  return {
    image: {
      strategy: o.image?.strategy ?? d.image.strategy,
      proxyBase: o.image?.proxyBase ?? d.image.proxyBase,
      stripQuery: o.image?.stripQuery ?? d.image.stripQuery,
      removeUnverifiable: o.image?.removeUnverifiable ?? d.image.removeUnverifiable,
      ...(o.image?.probe ? { probe: o.image.probe } : {}),
    },
    delays: {
      intraCard: o.delays?.intraCard ?? d.delays.intraCard,
      interProduct: o.delays?.interProduct ?? d.delays.interProduct,
      bubble: o.delays?.bubble ?? d.delays.bubble,
      min: o.delays?.min ?? d.delays.min,
      max: o.delays?.max ?? d.delays.max,
      perTransition: { ...d.delays.perTransition, ...o.delays?.perTransition },
    },
    fallback: {
      message: o.fallback?.message ?? d.fallback.message,
      handoff: o.fallback?.handoff !== undefined ? o.fallback.handoff : d.fallback.handoff,
    },
    normalize: {
      stripStandardMarkdown: o.normalize?.stripStandardMarkdown ?? d.normalize.stripStandardMarkdown,
      preserveWhatsappMarkup: o.normalize?.preserveWhatsappMarkup ?? d.normalize.preserveWhatsappMarkup,
      straightenQuotes: o.normalize?.straightenQuotes ?? d.normalize.straightenQuotes,
    },
    parser: {
      useFallbackLibrary: o.parser?.useFallbackLibrary ?? d.parser.useFallbackLibrary,
      maxRepairPasses: o.parser?.maxRepairPasses ?? d.parser.maxRepairPasses,
    },
    simulate: o.simulate ?? d.simulate,
    report: { level: o.report?.level ?? d.report.level },
  };
}
