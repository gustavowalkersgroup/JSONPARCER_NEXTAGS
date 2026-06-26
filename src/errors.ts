import type { Diagnostic, DiagnosticKind } from './types';

// Códigos estáveis de diagnóstico. Prefixo (ERR/REPAIR/WARN/PENDING) define a categoria.
export const Codes = {
  // Fatais
  ERR_IRRECOVERABLE_JSON: 'ERR_IRRECOVERABLE_JSON',
  ERR_ROOT_EMPTY: 'ERR_ROOT_EMPTY',
  // Erros não-fatais (item removido/rebaixado)
  ERR_INVALID_ATTACHMENT_TYPE: 'ERR_INVALID_ATTACHMENT_TYPE',
  ERR_CAROUSEL_TOO_SMALL: 'ERR_CAROUSEL_TOO_SMALL',
  ERR_BUTTON_MISSING_FIELD: 'ERR_BUTTON_MISSING_FIELD',
  // Reparos
  REPAIR_FENCE_STRIPPED: 'REPAIR_FENCE_STRIPPED',
  REPAIR_SMART_QUOTES: 'REPAIR_SMART_QUOTES',
  REPAIR_TRAILING_COMMA: 'REPAIR_TRAILING_COMMA',
  REPAIR_AUTOCLOSED: 'REPAIR_AUTOCLOSED',
  REPAIR_MISSING_COMMA: 'REPAIR_MISSING_COMMA',
  REPAIR_FALLBACK_LIB: 'REPAIR_FALLBACK_LIB',
  REPAIR_TYPE_MOVED_OUT_OF_PAYLOAD: 'REPAIR_TYPE_MOVED_OUT_OF_PAYLOAD',
  REPAIR_ACTION_ALIAS: 'REPAIR_ACTION_ALIAS',
  REPAIR_TYPING_CLAMPED: 'REPAIR_TYPING_CLAMPED',
  REPAIR_MARKDOWN_STRIPPED: 'REPAIR_MARKDOWN_STRIPPED',
  REPAIR_URL_NORMALIZED: 'REPAIR_URL_NORMALIZED',
  REPAIR_IMAGE_PROXIED: 'REPAIR_IMAGE_PROXIED',
  REPAIR_DELAYS_INSERTED: 'REPAIR_DELAYS_INSERTED',
  // Warnings
  WARN_BLOCK_AMBIGUOUS: 'WARN_BLOCK_AMBIGUOUS',
  WARN_MULTIPLE_WEB_URL: 'WARN_MULTIPLE_WEB_URL',
  WARN_CTA_TOO_LONG: 'WARN_CTA_TOO_LONG',
  WARN_NON_CANONICAL_HANDOFF: 'WARN_NON_CANONICAL_HANDOFF',
  // Pendências (requerem ação humana)
  PENDING_IMAGE_UNVERIFIABLE: 'PENDING_IMAGE_UNVERIFIABLE',
  PENDING_BUTTON_MISSING_TEXT: 'PENDING_BUTTON_MISSING_TEXT',
  PENDING_DIRTY_ADMIN_ID: 'PENDING_DIRTY_ADMIN_ID',
  PENDING_LEGACY_ACTION: 'PENDING_LEGACY_ACTION',
} as const;

export type Code = (typeof Codes)[keyof typeof Codes];

export class IrrecoverableError extends Error {
  constructor(
    message: string,
    public readonly code: Code,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'IrrecoverableError';
  }
}

export function diag(code: Code, message: string, extra?: Partial<Diagnostic>): Diagnostic {
  return { code, message, ...extra };
}

export const KIND_BY_PREFIX: Record<string, DiagnosticKind> = {
  ERR: 'error',
  REPAIR: 'repair',
  WARN: 'warning',
  PENDING: 'pending',
};
