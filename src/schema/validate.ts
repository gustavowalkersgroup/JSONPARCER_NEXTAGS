import type { Button, Diagnostic, MessageItem, NexTagsPayload } from '../types';
import { Codes, diag } from '../errors';
import { isValidPayload } from './schema';

const VALID_ATTACH = new Set(['image', 'video', 'audio', 'file', 'template']);

function fixButtons(buttons: Button[], diagnostics: Diagnostic[]): Button[] {
  let webUrlCount = 0;
  return buttons.filter((b) => {
    if (b.type === 'web_url' && !b.url) {
      diagnostics.push(diag(Codes.ERR_BUTTON_MISSING_FIELD, 'botão web_url sem url'));
      return false;
    }
    if (b.type === 'postback' && !b.payload) {
      diagnostics.push(diag(Codes.ERR_BUTTON_MISSING_FIELD, 'botão postback sem payload'));
      return false;
    }
    if (b.type === 'web_url' && ++webUrlCount > 1) {
      diagnostics.push(diag(Codes.WARN_MULTIPLE_WEB_URL, '>1 botão web_url por mensagem'));
      return false;
    }
    if (b.title && b.title.length > 20) {
      diagnostics.push(diag(Codes.WARN_CTA_TOO_LONG, `CTA >20 caracteres: ${b.title}`));
    }
    return true;
  });
}

// Validação corretiva: conserta/remove itens inválidos e classifica violações.
// Ao final, usa o schema zod como oráculo de validade residual.
export function validatePayload(payload: NexTagsPayload): {
  payload: NexTagsPayload;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];

  const messages = payload.messages
    ?.map((item: MessageItem): MessageItem | null => {
      if (typeof item === 'number') {
        const n = Math.round(item);
        if (n < 1 || n > 30) {
          diagnostics.push(diag(Codes.REPAIR_TYPING_CLAMPED, `typing ${item} fora de 1–30`));
          return Math.min(30, Math.max(1, n));
        }
        return n;
      }
      const att = item.message?.attachment;
      if (att) {
        if (!VALID_ATTACH.has(att.type)) {
          diagnostics.push(diag(Codes.ERR_INVALID_ATTACHMENT_TYPE, `type inválido: ${att.type}`));
          return null;
        }
        if (att.type === 'template') {
          const p = att.payload as {
            template_type?: string;
            text?: string;
            elements?: unknown[];
            buttons?: Button[];
          };
          if (p.template_type === 'generic') {
            if (!Array.isArray(p.elements) || p.elements.length < 2) {
              diagnostics.push(diag(Codes.ERR_CAROUSEL_TOO_SMALL, 'carrossel com <2 elementos'));
              return null;
            }
          }
          if (p.template_type === 'button') {
            if (!p.text) {
              diagnostics.push(diag(Codes.PENDING_BUTTON_MISSING_TEXT, 'button template sem text'));
            }
            if (Array.isArray(p.buttons)) {
              p.buttons = fixButtons(p.buttons, diagnostics);
            }
          }
        }
      }
      return item;
    })
    .filter((x): x is MessageItem => x !== null);

  const out: NexTagsPayload = {};
  if (messages) out.messages = messages;
  if (payload.actions) out.actions = payload.actions;

  // Oráculo de validade residual (defense-in-depth).
  const check = isValidPayload(out);
  if (!check.ok) {
    for (const issue of check.issues) {
      diagnostics.push(diag(Codes.WARN_RESIDUAL_SCHEMA, `Schema residual: ${issue}`));
    }
  }

  return { payload: out, diagnostics };
}
