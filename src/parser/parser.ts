import type { Diagnostic } from '../types';
import { Codes, diag, IrrecoverableError } from '../errors';
import type { Token } from './tokenizer';

// Parser recursive-descent com recuperação: auto-fecha estruturas truncadas e
// insere vírgulas faltantes, registrando cada recuperação como reparo.
export function parseTokens(tokens: Token[]): { value: unknown; repairs: Diagnostic[] } {
  const repairs: Diagnostic[] = [];
  let i = 0;
  const peek = (): Token | undefined => tokens[i];
  const next = (): Token | undefined => tokens[i++];
  const eof = (): boolean => i >= tokens.length;

  function parseValue(): unknown {
    const t = peek();
    if (!t) {
      repairs.push(diag(Codes.REPAIR_AUTOCLOSED, 'EOF inesperado: valor nulo assumido'));
      return null;
    }
    switch (t.kind) {
      case 'lbrace':
        return parseObject();
      case 'lbracket':
        return parseArray();
      case 'string':
      case 'number':
      case 'true':
      case 'false':
      case 'null':
        next();
        return t.value;
      default:
        next();
        return null;
    }
  }

  function parseObject(): Record<string, unknown> {
    next(); // consome '{'
    const obj: Record<string, unknown> = {};
    while (!eof()) {
      const t = peek();
      if (!t) break;
      if (t.kind === 'rbrace') {
        next();
        return obj;
      }
      if (t.kind === 'comma') {
        next();
        continue;
      }
      if (t.kind !== 'string') {
        next(); // chave inesperada: ignora
        continue;
      }
      const key = String(next()?.value ?? '');
      if (peek()?.kind === 'colon') next(); // tolera colon faltando
      obj[key] = parseValue();
      const after = peek();
      if (after && after.kind !== 'comma' && after.kind !== 'rbrace') {
        repairs.push(diag(Codes.REPAIR_MISSING_COMMA, 'Vírgula inserida entre membros'));
      }
    }
    repairs.push(diag(Codes.REPAIR_AUTOCLOSED, 'Objeto truncado auto-fechado'));
    return obj;
  }

  function parseArray(): unknown[] {
    next(); // consome '['
    const arr: unknown[] = [];
    while (!eof()) {
      const t = peek();
      if (!t) break;
      if (t.kind === 'rbracket') {
        next();
        return arr;
      }
      if (t.kind === 'comma') {
        next();
        continue;
      }
      arr.push(parseValue());
    }
    repairs.push(diag(Codes.REPAIR_AUTOCLOSED, 'Array truncado auto-fechado'));
    return arr;
  }

  if (eof()) throw new IrrecoverableError('Sem tokens para parsear', Codes.ERR_IRRECOVERABLE_JSON);
  const value = parseValue();
  return { value, repairs };
}
