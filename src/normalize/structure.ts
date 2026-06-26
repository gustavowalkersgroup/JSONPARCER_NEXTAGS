import type { Action, Diagnostic, MessageItem, NexTagsPayload } from '../types';
import { Codes, diag } from '../errors';
import { canonicalizeActions } from '../schema/actions';

// Coerção estrutural: garante o shape raiz, move `attachment.type` para fora do
// payload (erro mais comum) e canoniza as ações.
export function coerceStructure(value: unknown): {
  value: NexTagsPayload;
  diagnostics: Diagnostic[];
  fatal: boolean;
} {
  const diagnostics: Diagnostic[] = [];
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  const messages = Array.isArray(v.messages) ? (v.messages as MessageItem[]) : undefined;
  let actions = Array.isArray(v.actions) ? (v.actions as Action[]) : undefined;

  if (messages) {
    for (const item of messages) {
      if (typeof item === 'number') continue;
      const att = item?.message?.attachment as
        | { type?: string; payload?: Record<string, unknown> }
        | undefined;
      if (att?.payload && typeof att.payload === 'object' && att.payload.type && !att.type) {
        att.type = att.payload.type as string;
        delete att.payload.type;
        diagnostics.push(
          diag(
            Codes.REPAIR_TYPE_MOVED_OUT_OF_PAYLOAD,
            'attachment.type movido para fora do payload',
          ),
        );
      }
    }
  }

  if (actions) {
    const c = canonicalizeActions(actions);
    actions = c.actions;
    diagnostics.push(...c.diagnostics);
  }

  const hasMsg = !!messages && messages.length > 0;
  const hasAct = !!actions && actions.length > 0;
  const fatal = !hasMsg && !hasAct;
  if (fatal) {
    diagnostics.push(diag(Codes.ERR_ROOT_EMPTY, 'Raiz sem messages nem actions', { fatal: true }));
  }

  const out: NexTagsPayload = {};
  if (messages) out.messages = messages;
  if (actions) out.actions = actions;
  return { value: out, diagnostics, fatal };
}
