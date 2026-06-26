import type { Action, Diagnostic } from '../types';
import { Codes, diag } from '../errors';

// Aliases que o agente costuma errar → forma canônica.
export const ACTION_ALIASES: Record<string, string> = {
  addtag: 'add_tag',
  'add-tag': 'add_tag',
  tag_add: 'add_tag',
  removetag: 'remove_tag',
  'remove-tag': 'remove_tag',
  tag_remove: 'remove_tag',
  setfield: 'set_field_value',
  set_field: 'set_field_value',
  setfieldvalue: 'set_field_value',
  unsetfield: 'unset_field_value',
  clear_field: 'unset_field_value',
  unsetfieldvalue: 'unset_field_value',
  sendflow: 'send_flow',
  'send-flow': 'send_flow',
  trigger_flow: 'send_flow',
  flow: 'send_flow',
  transfer: 'transfer_conversation_to',
  transfer_to_human: 'transfer_conversation_to',
  transferhuman: 'transfer_conversation_to',
  assign: 'assign_conversation',
  assignto: 'assign_conversation',
  assign_to: 'assign_conversation',
  unassign: 'unassign_conversation',
  unassign_admin: 'unassign_conversation',
};

export const CANONICAL_ACTIONS = new Set([
  'add_tag',
  'remove_tag',
  'set_field_value',
  'unset_field_value',
  'send_flow',
  'transfer_conversation_to',
  'assign_conversation',
  'unassign_conversation',
]);

// Sintaxe legada de plataforma antiga: chamadas de função `()` ou template `{{...}}`.
const LEGACY = /\(\)|\{\{|\}\}/;

export function canonicalizeActions(actions: Action[]): {
  actions: Action[];
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const out: Action[] = [];

  for (const a of actions) {
    const name = String(a.action ?? '');
    if (LEGACY.test(name)) {
      diagnostics.push(diag(Codes.PENDING_LEGACY_ACTION, `Ação legada removida: ${name}`));
      continue;
    }
    const key = name.toLowerCase().replace(/\s/g, '');
    const canon = CANONICAL_ACTIONS.has(name) ? name : ACTION_ALIASES[key];
    if (canon && canon !== name) {
      diagnostics.push(diag(Codes.REPAIR_ACTION_ALIAS, `${name} → ${canon}`));
    }
    const action: Action = { ...a, action: canon ?? name };

    if (action.action === 'transfer_conversation_to' || action.action === 'assign_conversation') {
      diagnostics.push(
        diag(Codes.WARN_NON_CANONICAL_HANDOFF, 'Padrão de handoff recomendado é send_flow'),
      );
    }
    if (
      action.action === 'assign_conversation' &&
      !/^[\w-]+$/.test(String(action.admin_id ?? ''))
    ) {
      diagnostics.push(
        diag(Codes.PENDING_DIRTY_ADMIN_ID, `admin_id inválido: ${String(action.admin_id)}`),
      );
    }
    out.push(action);
  }

  return { actions: out, diagnostics };
}
