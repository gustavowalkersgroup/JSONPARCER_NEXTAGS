// ============================================================================
//  whatsapp-ai-middleware — CARD ÚNICO (NexTags / n8n Code node)
//  Vanilla JS, ZERO dependências. Cole isto inteiro no Code node.
//  Modo do node: "Run Once for All Items".
//
//  O que faz: pega a saída crua da IA, repara JSON quebrado, valida/normaliza,
//  reescreve imagens pelo proxy, insere delays entre blocos imagem→template e
//  devolve SÓ o JSON validado no campo do cliente (diagnóstico vai separado).
// ============================================================================

// ===== 1) CONFIG — edite só aqui =====================================
const CONFIG = {
  inputField: 'output', // campo do item com a saída crua da IA (ex.: output/text/response)
  clientField: 'resposta', // campo que vai pro cliente (SÓ o JSON validado)
  debugField: '_debug', // campo interno de diagnóstico (NUNCA mande pro cliente)
  stringifyClient: true, // true: resposta como string JSON; false: objeto
  image: {
    strategy: 'proxy', // 'proxy' (reescreve via proxyBase) | 'detect-only' (remove webp)
    proxyBase: 'https://nextags.app.br/webhook/cf-img-proxy',
    stripQuery: true,
  },
  delays: { intraCard: 4, interProduct: 7, bubble: 4, min: 1, max: 30 },
  fallback: {
    message: 'Só um instante que já te respondo 😊',
    handoff: { action: 'send_flow', flow_id: '' }, // flow_id vazio = sem handoff
  },
};

// ===== 2) BIBLIOTECA — não precisa editar ============================
function buildMiddleware(CFG) {
  const push = (rep, kind, code, msg) => rep[kind].push({ code, message: msg });

  // ---- parser: extract ----
  function extract(raw, rep) {
    let s = String(raw == null ? '' : raw).trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fence && fence[1]) {
      s = fence[1].trim();
      push(rep, 'repairs', 'REPAIR_FENCE_STRIPPED', 'cerca markdown removida');
    }
    const start = s.indexOf('{');
    if (start === -1) return s;
    let depth = 0,
      inStr = false,
      esc = false,
      end = -1;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    return end === -1 ? s.slice(start) : s.slice(start, end + 1);
  }

  // ---- parser: repair de texto ----
  function repairText(input, rep) {
    let s = input;
    if (/[“”‘’]/.test(s)) {
      s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
      push(rep, 'repairs', 'REPAIR_SMART_QUOTES', 'aspas tipográficas normalizadas');
    }
    let out = '',
      inStr = false,
      esc = false,
      changed = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        out += c;
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        out += c;
        continue;
      }
      if (c === ',') {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] === '}' || s[j] === ']') {
          changed = true;
          continue;
        }
      }
      out += c;
    }
    if (changed) push(rep, 'repairs', 'REPAIR_TRAILING_COMMA', 'vírgula final removida');
    return out;
  }

  // ---- parser: tokenizer tolerante ----
  const SINGLE = { '{': 'lbrace', '}': 'rbrace', '[': 'lbracket', ']': 'rbracket', ':': 'colon', ',': 'comma' };
  function tokenize(s) {
    const t = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (SINGLE[c]) {
        t.push({ kind: SINGLE[c] });
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        const q = c;
        let j = i + 1,
          val = '';
        while (j < s.length) {
          const d = s[j];
          if (d === '\\') {
            const n = s[j + 1];
            if (n === 'n') val += '\n';
            else if (n === 't') val += '\t';
            else if (n === 'r') val += '\r';
            else if (n === 'b') val += '\b';
            else if (n === 'f') val += '\f';
            else if (n === '/') val += '/';
            else if (n === '"') val += '"';
            else if (n === "'") val += "'";
            else if (n === '\\') val += '\\';
            else if (n === 'u') {
              const hex = s.slice(j + 2, j + 6);
              if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                val += String.fromCharCode(parseInt(hex, 16));
                j += 4;
              } else val += n || '';
            } else val += n || '';
            j += 2;
            continue;
          }
          if (d === q) break;
          val += d;
          j++;
        }
        t.push({ kind: 'string', value: val });
        i = j + 1;
        continue;
      }
      const num = s.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (num) {
        t.push({ kind: 'number', value: Number(num[0]) });
        i += num[0].length;
        continue;
      }
      const lit = s.slice(i).match(/^(true|false|null)/);
      if (lit) {
        const v = lit[0];
        t.push({ kind: v, value: v === 'true' ? true : v === 'false' ? false : null });
        i += v.length;
        continue;
      }
      i++;
    }
    return t;
  }

  // ---- parser: recursive-descent com recuperação ----
  function parseTokens(tokens, rep) {
    let i = 0;
    const peek = () => tokens[i];
    const next = () => tokens[i++];
    const eof = () => i >= tokens.length;
    function parseValue() {
      const t = peek();
      if (!t) return null;
      if (t.kind === 'lbrace') return parseObject();
      if (t.kind === 'lbracket') return parseArray();
      if (['string', 'number', 'true', 'false', 'null'].indexOf(t.kind) !== -1) {
        next();
        return t.value;
      }
      next();
      return null;
    }
    function parseObject() {
      next();
      const obj = {};
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
          next();
          continue;
        }
        const key = String(next().value);
        if (peek() && peek().kind === 'colon') next();
        obj[key] = parseValue();
      }
      push(rep, 'repairs', 'REPAIR_AUTOCLOSED', 'objeto truncado auto-fechado');
      return obj;
    }
    function parseArray() {
      next();
      const arr = [];
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
      push(rep, 'repairs', 'REPAIR_AUTOCLOSED', 'array truncado auto-fechado');
      return arr;
    }
    if (eof()) throw new Error('sem tokens');
    return parseValue();
  }

  function parseRecover(raw, rep) {
    const txt = repairText(extract(raw, rep), rep);
    try {
      const v = JSON.parse(txt);
      if (v && typeof v === 'object') return v;
    } catch (e) {}
    try {
      const v = parseTokens(tokenize(txt), rep);
      if (v && typeof v === 'object') return v;
    } catch (e) {}
    throw new Error('JSON irrecuperável');
  }

  // ---- ações: canonicalização ----
  const ALIASES = {
    addtag: 'add_tag', 'add-tag': 'add_tag', tag_add: 'add_tag',
    removetag: 'remove_tag', 'remove-tag': 'remove_tag', tag_remove: 'remove_tag',
    setfield: 'set_field_value', set_field: 'set_field_value', setfieldvalue: 'set_field_value',
    unsetfield: 'unset_field_value', clear_field: 'unset_field_value', unsetfieldvalue: 'unset_field_value',
    sendflow: 'send_flow', 'send-flow': 'send_flow', trigger_flow: 'send_flow', flow: 'send_flow',
    transfer: 'transfer_conversation_to', transfer_to_human: 'transfer_conversation_to', transferhuman: 'transfer_conversation_to',
    assign: 'assign_conversation', assignto: 'assign_conversation', assign_to: 'assign_conversation',
    unassign: 'unassign_conversation', unassign_admin: 'unassign_conversation',
  };
  const CANON = new Set([
    'add_tag', 'remove_tag', 'set_field_value', 'unset_field_value',
    'send_flow', 'transfer_conversation_to', 'assign_conversation', 'unassign_conversation',
  ]);
  function canonicalizeActions(actions, rep) {
    const out = [];
    for (const a of actions) {
      const name = String((a && a.action) || '');
      if (/\(\)|\{\{|\}\}/.test(name)) {
        push(rep, 'pending', 'PENDING_LEGACY_ACTION', 'ação legada removida: ' + name);
        continue;
      }
      const key = name.toLowerCase().replace(/\s/g, '');
      const canon = CANON.has(name) ? name : ALIASES[key];
      if (canon && canon !== name) push(rep, 'repairs', 'REPAIR_ACTION_ALIAS', name + ' → ' + canon);
      const action = Object.assign({}, a, { action: canon || name });
      if (action.action === 'transfer_conversation_to' || action.action === 'assign_conversation')
        push(rep, 'warnings', 'WARN_NON_CANONICAL_HANDOFF', 'handoff recomendado é send_flow');
      if (action.action === 'assign_conversation' && !/^[\w-]+$/.test(String(action.admin_id || '')))
        push(rep, 'pending', 'PENDING_DIRTY_ADMIN_ID', 'admin_id inválido');
      out.push(action);
    }
    return out;
  }

  // ---- coerção estrutural ----
  function coerceStructure(value, rep) {
    const v = value && typeof value === 'object' ? value : {};
    const messages = Array.isArray(v.messages) ? v.messages : undefined;
    let actions = Array.isArray(v.actions) ? v.actions : undefined;
    if (messages)
      for (const item of messages) {
        if (typeof item === 'number') continue;
        const att = item && item.message && item.message.attachment;
        if (att && att.payload && typeof att.payload === 'object' && att.payload.type && !att.type) {
          att.type = att.payload.type;
          delete att.payload.type;
          push(rep, 'repairs', 'REPAIR_TYPE_MOVED_OUT_OF_PAYLOAD', 'type movido pra fora do payload');
        }
      }
    if (actions) actions = canonicalizeActions(actions, rep);
    const hasMsg = !!messages && messages.length > 0;
    const hasAct = !!actions && actions.length > 0;
    const out = {};
    if (messages) out.messages = messages;
    if (actions) out.actions = actions;
    return { value: out, fatal: !hasMsg && !hasAct };
  }

  // ---- validação corretiva ----
  const VALID_ATTACH = new Set(['image', 'video', 'audio', 'file', 'template']);
  function fixButtons(buttons, rep) {
    let web = 0;
    return buttons.filter((b) => {
      if (b.type === 'web_url' && !b.url) {
        push(rep, 'errors', 'ERR_BUTTON_MISSING_FIELD', 'web_url sem url');
        return false;
      }
      if (b.type === 'postback' && !b.payload) {
        push(rep, 'errors', 'ERR_BUTTON_MISSING_FIELD', 'postback sem payload');
        return false;
      }
      if (b.type === 'web_url' && ++web > 1) {
        push(rep, 'warnings', 'WARN_MULTIPLE_WEB_URL', '>1 botão web_url');
        return false;
      }
      if (b.title && b.title.length > 20) push(rep, 'warnings', 'WARN_CTA_TOO_LONG', 'CTA >20: ' + b.title);
      return true;
    });
  }
  function validatePayload(payload, rep) {
    const msgs = payload.messages;
    if (Array.isArray(msgs)) {
      payload.messages = msgs
        .map((item) => {
          if (typeof item === 'number') {
            const n = Math.round(item);
            if (n < 1 || n > 30) {
              push(rep, 'repairs', 'REPAIR_TYPING_CLAMPED', 'typing fora de 1-30');
              return Math.min(30, Math.max(1, n));
            }
            return n;
          }
          const att = item && item.message && item.message.attachment;
          if (att) {
            if (!VALID_ATTACH.has(att.type)) {
              push(rep, 'errors', 'ERR_INVALID_ATTACHMENT_TYPE', 'type inválido: ' + att.type);
              return null;
            }
            if (att.type === 'template') {
              const p = att.payload || {};
              if (p.template_type === 'generic' && (!Array.isArray(p.elements) || p.elements.length < 2)) {
                push(rep, 'errors', 'ERR_CAROUSEL_TOO_SMALL', 'carrossel <2');
                return null;
              }
              if (p.template_type === 'button') {
                if (!p.text) push(rep, 'pending', 'PENDING_BUTTON_MISSING_TEXT', 'button sem text');
                if (Array.isArray(p.buttons)) p.buttons = fixButtons(p.buttons, rep);
              }
            }
          }
          return item;
        })
        .filter((x) => x !== null);
    }
    return payload;
  }

  // ---- normalização de texto (preserva WA-markup *_~ e emojis) ----
  function normText(input, rep) {
    let s = input;
    s = s.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
    s = s.replace(/```[\s\S]*?```/g, '');
    s = s.replace(/`([^`]+)`/g, '$1');
    s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
    s = s.replace(/^\s{0,3}>\s?/gm, '');
    s = s.replace(/^\s*[-*+]\s+/gm, '');
    s = s.replace(/[ \t]+\n/g, '\n').trim();
    if (s !== input) push(rep, 'repairs', 'REPAIR_MARKDOWN_STRIPPED', 'markdown-padrão removido');
    return s;
  }
  function normalizeText(payload, rep) {
    const ap = (v) => (typeof v === 'string' ? normText(v, rep) : v);
    for (const item of payload.messages || []) {
      if (typeof item === 'number') continue;
      const m = item.message;
      if (m.text !== undefined) m.text = ap(m.text);
      const p = m.attachment && m.attachment.payload;
      if (p && p.text !== undefined) p.text = ap(p.text);
      for (const el of (p && p.elements) || []) {
        if (el.title !== undefined) el.title = ap(el.title);
        if (el.subtitle !== undefined) el.subtitle = ap(el.subtitle);
      }
    }
    return payload;
  }

  // ---- imagens ----
  const BAD_EXT = /\.(webp|avif|svg|gif|bmp|tiff?|heic|heif)(\.|$)/i;
  function normUrl(url) {
    if (!CFG.image.stripQuery) return { url: url, changed: false };
    const s = url.split('?')[0] || url;
    return { url: s, changed: s !== url };
  }
  function looksUnverifiable(url) {
    const p = (url.split('?')[0] || url).toLowerCase();
    if (BAD_EXT.test(p)) return true;
    return !/\.(jpe?g|png)$/.test(p);
  }
  function rewriteImages(payload, rep) {
    const img = CFG.image;
    const handle = (url) => {
      const n = normUrl(url);
      if (n.changed) push(rep, 'repairs', 'REPAIR_URL_NORMALIZED', 'URL normalizada');
      if (img.strategy === 'proxy' && img.proxyBase) {
        push(rep, 'repairs', 'REPAIR_IMAGE_PROXIED', 'imagem via proxy');
        return { url: img.proxyBase + '?u=' + encodeURIComponent(n.url) };
      }
      if (looksUnverifiable(n.url)) {
        push(rep, 'pending', 'PENDING_IMAGE_UNVERIFIABLE', 'imagem não-garantível removida: ' + n.url);
        return { remove: true };
      }
      return { url: n.url };
    };
    for (const item of payload.messages || []) {
      if (typeof item === 'number') continue;
      const att = item.message && item.message.attachment;
      if (att && att.type === 'image' && att.payload && typeof att.payload.url === 'string') {
        const r = handle(att.payload.url);
        if (r.remove) delete item.message.attachment;
        else att.payload.url = r.url;
      }
      const els = att && att.payload && att.payload.elements;
      for (const el of els || []) {
        if (typeof el.image_url === 'string') {
          const r = handle(el.image_url);
          if (r.remove) delete el.image_url;
          else el.image_url = r.url;
        }
      }
    }
    return payload;
  }

  // ---- blocos + delays ----
  function kindOf(item) {
    if (typeof item === 'number') return 'DELAY';
    const att = item.message && item.message.attachment;
    if (att) return att.type === 'template' ? 'TEMPLATE' : att.type.toUpperCase();
    return 'TEXT';
  }
  function insertDelays(messages, rep) {
    const msgs = messages.filter((m) => typeof m !== 'number');
    const kinds = msgs.map(kindOf);
    const cardStart = new Set();
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] === 'IMAGE') {
        if (kinds[i + 1] === 'TEMPLATE') {
          cardStart.add(i);
          i++;
        } else push(rep, 'warnings', 'WARN_BLOCK_AMBIGUOUS', 'imagem órfã na posição ' + i);
      }
    }
    const d = CFG.delays;
    const clamp = (n) => Math.min(d.max, Math.max(d.min, n));
    const out = [];
    let seenCard = false;
    for (let i = 0; i < msgs.length; i++) {
      if (i > 0) {
        let val;
        if (cardStart.has(i - 1)) val = d.intraCard;
        else if (cardStart.has(i) && seenCard) val = d.interProduct;
        else val = d.bubble;
        out.push(clamp(val));
      }
      if (cardStart.has(i)) seenCard = true;
      out.push(msgs[i]);
    }
    if (msgs.length > 1) push(rep, 'repairs', 'REPAIR_DELAYS_INSERTED', 'delays inseridos');
    return out;
  }

  // ---- fallback ----
  function fallbackPayload() {
    const p = { messages: [{ message: { text: CFG.fallback.message } }] };
    const h = CFG.fallback.handoff;
    if (h && h.flow_id) p.actions = [{ action: h.action || 'send_flow', flow_id: h.flow_id }];
    return p;
  }

  // ---- orquestrador ----
  function process(raw) {
    const rep = { repairs: [], warnings: [], errors: [], pending: [] };
    try {
      const parsed = parseRecover(raw, rep);
      const c = coerceStructure(parsed, rep);
      if (c.fatal) throw new Error('raiz vazia');
      let payload = c.value;
      payload = validatePayload(payload, rep);
      payload = normalizeText(payload, rep);
      payload = rewriteImages(payload, rep);
      if (Array.isArray(payload.messages)) payload.messages = insertDelays(payload.messages, rep);
      return { ok: true, data: payload, report: rep };
    } catch (e) {
      rep.errors.push({ code: 'ERR_IRRECOVERABLE', message: String((e && e.message) || e) });
      return { ok: false, data: fallbackPayload(), report: rep };
    }
  }

  return { process: process };
}

// ===== 3) EXECUÇÃO no n8n =============================================
const MW = buildMiddleware(CONFIG);
const items = $input.all();

return items.map((it) => {
  const j = it.json || {};
  // pega a saída crua da IA: campo configurado, com fallbacks comuns
  let raw = j[CONFIG.inputField];
  if (raw == null) raw = j.output != null ? j.output : j.text != null ? j.text : j.response;
  if (raw == null) raw = j; // último recurso: o próprio item
  if (raw != null && typeof raw !== 'string') raw = JSON.stringify(raw);

  const r = MW.process(raw);
  const out = {};
  out[CONFIG.clientField] = CONFIG.stringifyClient ? JSON.stringify(r.data) : r.data;
  out[CONFIG.debugField] = { ok: r.ok, report: r.report };
  return { json: out };
});
