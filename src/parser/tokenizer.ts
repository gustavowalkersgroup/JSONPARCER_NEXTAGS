export type TokenKind =
  | 'lbrace'
  | 'rbrace'
  | 'lbracket'
  | 'rbracket'
  | 'colon'
  | 'comma'
  | 'string'
  | 'number'
  | 'true'
  | 'false'
  | 'null';

export interface Token {
  kind: TokenKind;
  value?: string | number | boolean | null;
  pos: number;
}

const SINGLE: Record<string, TokenKind> = {
  '{': 'lbrace',
  '}': 'rbrace',
  '[': 'lbracket',
  ']': 'rbracket',
  ':': 'colon',
  ',': 'comma',
};

// Tokenizer tolerante: aceita aspas simples/duplas, decodifica escapes
// manualmente (robusto a truncamento) e ignora caracteres inesperados.
export function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const single = SINGLE[c];
    if (single) {
      tokens.push({ kind: single, pos: i });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      let val = '';
      while (j < s.length) {
        const d = s[j] as string;
        if (d === '\\') {
          const n = s[j + 1];
          switch (n) {
            case 'n':
              val += '\n';
              break;
            case 't':
              val += '\t';
              break;
            case 'r':
              val += '\r';
              break;
            case 'b':
              val += '\b';
              break;
            case 'f':
              val += '\f';
              break;
            case '/':
              val += '/';
              break;
            case '"':
              val += '"';
              break;
            case "'":
              val += "'";
              break;
            case '\\':
              val += '\\';
              break;
            case 'u': {
              const hex = s.slice(j + 2, j + 6);
              if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                val += String.fromCharCode(parseInt(hex, 16));
                j += 4;
              } else {
                val += n ?? '';
              }
              break;
            }
            default:
              val += n ?? '';
          }
          j += 2;
          continue;
        }
        if (d === q) break;
        val += d;
        j++;
      }
      tokens.push({ kind: 'string', value: val, pos: i });
      i = j + 1;
      continue;
    }
    const num = s.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (num) {
      tokens.push({ kind: 'number', value: Number(num[0]), pos: i });
      i += num[0].length;
      continue;
    }
    const lit = s.slice(i).match(/^(true|false|null)/);
    if (lit) {
      const v = lit[0] as 'true' | 'false' | 'null';
      tokens.push({ kind: v, value: v === 'true' ? true : v === 'false' ? false : null, pos: i });
      i += v.length;
      continue;
    }
    i++; // caractere inesperado: ignora (tolerância)
  }
  return tokens;
}
