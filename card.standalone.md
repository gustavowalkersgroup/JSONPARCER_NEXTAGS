# card.standalone — código limpo (colar no Code node NexTags)

Versão enxuta, report = só códigos. Entra por `resposta_ia`, sai por `resposta_limpa`.
Descritivo (o que cada código significa) fica em `card.standalone.js`.

```js
// whatsapp-ai-middleware — CARD ÚNICO (NexTags / n8n Code node, "Run Once for All Items").
// Entra pelo campo resposta_ia, sai pelo campo resposta_limpa.
// A NexTags referencia esses campos como {{resposta_ia}} / {{resposta_limpa}} em outros nodes — não renomeie.

const CONFIG = {
  inputField: 'resposta_ia',
  clientField: 'resposta_limpa',
  debugField: '_debug',
  stringifyClient: true,
  image: { strategy: 'proxy', proxyBase: 'https://nextags.app.br/webhook/cf-img-proxy', stripQuery: true },
  delays: { intraCard: 4, interProduct: 7, bubble: 4, min: 1, max: 30 },
  fallbackMessage: 'Só um instante que já te respondo 😊',
};

function buildMiddleware(CFG) {
  const push = (rep, kind, code) => rep[kind].push({ code });

  function extract(raw, rep) {
    let s = String(raw == null ? '' : raw).trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fence && fence[1]) { s = fence[1].trim(); push(rep, 'repairs', 'REPAIR_FENCE_STRIPPED'); }
    const start = s.indexOf('{');
    if (start === -1) return s;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { end = i; break; }
    }
    return end === -1 ? s.slice(start) : s.slice(start, end + 1);
  }

  function repairText(input, rep) {
    let s = input;
    if (/[“”‘’]/.test(s)) { s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"); push(rep, 'repairs', 'REPAIR_SMART_QUOTES'); }
    let out = '', inStr = false, esc = false, changed = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; out += c; continue; }
      if (c === ',') { let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++; if (s[j] === '}' || s[j] === ']') { changed = true; continue; } }
      out += c;
    }
    if (changed) push(rep, 'repairs', 'REPAIR_TRAILING_COMMA');
    return out;
  }

  const SINGLE = { '{': 'lbrace', '}': 'rbrace', '[': 'lbracket', ']': 'rbracket', ':': 'colon', ',': 'comma' };
  const ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '/': '/', '"': '"', "'": "'", '\\': '\\' };
  function tokenize(s) {
    const t = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (SINGLE[c]) { t.push({ kind: SINGLE[c] }); i++; continue; }
      if (c === '"' || c === "'") {
        const q = c; let j = i + 1, val = '';
        while (j < s.length) {
          const d = s[j];
          if (d === '\\') {
            const n = s[j + 1];
            if (n === 'u') {
              const hex = s.slice(j + 2, j + 6);
              if (/^[0-9a-fA-F]{4}$/.test(hex)) { val += String.fromCharCode(parseInt(hex, 16)); j += 4; } else val += n || '';
            } else val += ESC[n] !== undefined ? ESC[n] : n || '';
            j += 2; continue;
          }
          if (d === q) break;
          val += d; j++;
        }
        t.push({ kind: 'string', value: val }); i = j + 1; continue;
      }
      const num = s.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (num) { t.push({ kind: 'number', value: Number(num[0]) }); i += num[0].length; continue; }
      const lit = s.slice(i).match(/^(true|false|null)/);
      if (lit) { const v = lit[0]; t.push({ kind: v, value: v === 'true' ? true : v === 'false' ? false : null }); i += v.length; continue; }
      i++;
    }
    return t;
  }

  function parseTokens(tokens, rep) {
    let i = 0;
    const peek = () => tokens[i], next = () => tokens[i++], eof = () => i >= tokens.length;
    function parseValue() {
      const t = peek();
      if (!t) return null;
      if (t.kind === 'lbrace') return parseObject();
      if (t.kind === 'lbracket') return parseArray();
      if (['string', 'number', 'true', 'false', 'null'].indexOf(t.kind) !== -1) { next(); return t.value; }
      next(); return null;
    }
    function parseObject() {
      next(); const obj = {};
      while (!eof()) {
        const t = peek(); if (!t) break;
        if (t.kind === 'rbrace') { next(); return obj; }
        if (t.kind === 'comma') { next(); continue; }
        if (t.kind !== 'string') { next(); continue; }
        const key = String(next().value);
        if (peek() && peek().kind === 'colon') next();
        obj[key] = parseValue();
      }
      push(rep, 'repairs', 'REPAIR_AUTOCLOSED'); return obj;
    }
    function parseArray() {
      next(); const arr = [];
      while (!eof()) {
        const t = peek(); if (!t) break;
        if (t.kind === 'rbracket') { next(); return arr; }
        if (t.kind === 'comma') { next(); continue; }
        arr.push(parseValue());
      }
      push(rep, 'repairs', 'REPAIR_AUTOCLOSED'); return arr;
    }
    if (eof()) throw new Error('sem tokens');
    return parseValue();
  }

  function parseRecover(raw, rep) {
    const txt = repairText(extract(raw, rep), rep);
    try { const v = JSON.parse(txt); if (v && typeof v === 'object') return v; } catch (e) {}
    try { const v = parseTokens(tokenize(txt), rep); if (v && typeof v === 'object') return v; } catch (e) {}
    throw new Error('JSON irrecuperável');
  }

  const ALIASES = {
    addtag: 'add_tag', 'add-tag': 'add_tag', tag_add: 'add_tag',
    removetag: 'remove_tag', 'remove-tag': 'remove_tag', tag_remove: 'remove_tag',
    setfield: 'set_field_value', set_field: 'set_field_value', setfieldvalue: 'set_field_value',
    unsetfield: 'unset_field_value', clear_field: 'unset_field_value', unsetfieldvalue: 'unset_field_value',
    sendflow: 'send_flow', 'send-flow': 'send_flow', trigger_flow: 'send_flow', flow: 'send_flow',
  };
  const CANON = new Set(['add_tag', 'remove_tag', 'set_field_value', 'unset_field_value', 'send_flow']);
  const HANDOFF = /transfer|assign|human/i;
  function canonicalizeActions(actions, rep) {
    const out = [];
    for (const a of actions) {
      const name = String((a && a.action) || '');
      if (HANDOFF.test(name)) { push(rep, 'pending', 'PENDING_HANDOFF'); continue; }
      if (/\(\)|\{\{|\}\}/.test(name)) { push(rep, 'pending', 'PENDING_LEGACY_ACTION'); continue; }
      const key = name.toLowerCase().replace(/\s/g, '');
      const canon = CANON.has(name) ? name : ALIASES[key];
      if (canon && canon !== name) push(rep, 'repairs', 'REPAIR_ACTION_ALIAS');
      out.push(Object.assign({}, a, { action: canon || name }));
    }
    return out;
  }

  function coerceStructure(value, rep) {
    const v = value && typeof value === 'object' ? value : {};
    const messages = Array.isArray(v.messages) ? v.messages : undefined;
    let actions = Array.isArray(v.actions) ? v.actions : undefined;
    for (const item of messages || []) {
      if (typeof item === 'number') continue;
      const att = item && item.message && item.message.attachment;
      if (att && att.payload && typeof att.payload === 'object' && att.payload.type && !att.type) {
        att.type = att.payload.type; delete att.payload.type;
        push(rep, 'repairs', 'REPAIR_TYPE_MOVED_OUT_OF_PAYLOAD');
      }
    }
    if (actions) actions = canonicalizeActions(actions, rep);
    const out = {};
    if (messages) out.messages = messages;
    if (actions) out.actions = actions;
    const hasMsg = !!messages && messages.length > 0;
    const hasAct = !!actions && actions.length > 0;
    return { value: out, fatal: !hasMsg && !hasAct };
  }

  const VALID_ATTACH = new Set(['image', 'video', 'audio', 'file', 'template']);
  function fixButtons(buttons, rep) {
    let web = 0;
    return buttons.filter((b) => {
      if (b.type === 'web_url' && !b.url) { push(rep, 'errors', 'ERR_BUTTON_MISSING_FIELD'); return false; }
      if (b.type === 'postback' && !b.payload) { push(rep, 'errors', 'ERR_BUTTON_MISSING_FIELD'); return false; }
      if (b.type === 'web_url' && ++web > 1) { push(rep, 'warnings', 'WARN_MULTIPLE_WEB_URL'); return false; }
      if (b.title && b.title.length > 20) push(rep, 'warnings', 'WARN_CTA_TOO_LONG');
      return true;
    });
  }
  function validatePayload(payload, rep) {
    if (!Array.isArray(payload.messages)) return payload;
    payload.messages = payload.messages.map((item) => {
      if (typeof item === 'number') {
        const n = Math.round(item);
        if (n < 1 || n > 30) { push(rep, 'repairs', 'REPAIR_TYPING_CLAMPED'); return Math.min(30, Math.max(1, n)); }
        return n;
      }
      const att = item && item.message && item.message.attachment;
      if (att) {
        if (!VALID_ATTACH.has(att.type)) { push(rep, 'errors', 'ERR_INVALID_ATTACHMENT_TYPE'); return null; }
        if (att.type === 'template') {
          const p = att.payload || {};
          if (p.template_type === 'generic' && (!Array.isArray(p.elements) || p.elements.length < 2)) { push(rep, 'errors', 'ERR_CAROUSEL_TOO_SMALL'); return null; }
          if (p.template_type === 'button') {
            if (!p.text) push(rep, 'pending', 'PENDING_BUTTON_MISSING_TEXT');
            if (Array.isArray(p.buttons)) p.buttons = fixButtons(p.buttons, rep);
          }
        }
      }
      return item;
    }).filter((x) => x !== null);
    return payload;
  }

  function normText(input, rep) {
    const s = input
      .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/[ \t]+\n/g, '\n').trim();
    if (s !== input) push(rep, 'repairs', 'REPAIR_MARKDOWN_STRIPPED');
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

  const BAD_EXT = /\.(webp|avif|svg|gif|bmp|tiff?|heic|heif)(\.|$)/i;
  function normUrl(url) {
    if (!CFG.image.stripQuery) return { url, changed: false };
    const s = url.split('?')[0] || url;
    return { url: s, changed: s !== url };
  }
  function looksUnverifiable(url) {
    const p = (url.split('?')[0] || url).toLowerCase();
    return BAD_EXT.test(p) || !/\.(jpe?g|png)$/.test(p);
  }
  function rewriteImages(payload, rep) {
    const img = CFG.image;
    const handle = (url) => {
      const n = normUrl(url);
      if (n.changed) push(rep, 'repairs', 'REPAIR_URL_NORMALIZED');
      if (img.strategy === 'proxy' && img.proxyBase) { push(rep, 'repairs', 'REPAIR_IMAGE_PROXIED'); return { url: img.proxyBase + '?u=' + encodeURIComponent(n.url) }; }
      if (looksUnverifiable(n.url)) { push(rep, 'pending', 'PENDING_IMAGE_UNVERIFIABLE'); return { remove: true }; }
      return { url: n.url };
    };
    for (const item of payload.messages || []) {
      if (typeof item === 'number') continue;
      const att = item.message && item.message.attachment;
      if (att && att.type === 'image' && att.payload && typeof att.payload.url === 'string') {
        const r = handle(att.payload.url);
        if (r.remove) delete item.message.attachment; else att.payload.url = r.url;
      }
      for (const el of (att && att.payload && att.payload.elements) || []) {
        if (typeof el.image_url === 'string') {
          const r = handle(el.image_url);
          if (r.remove) delete el.image_url; else el.image_url = r.url;
        }
      }
    }
    return payload;
  }

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
        if (kinds[i + 1] === 'TEMPLATE') { cardStart.add(i); i++; }
        else push(rep, 'warnings', 'WARN_BLOCK_AMBIGUOUS');
      }
    }
    const d = CFG.delays, clamp = (n) => Math.min(d.max, Math.max(d.min, n));
    const out = []; let seenCard = false;
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
    if (msgs.length > 1) push(rep, 'repairs', 'REPAIR_DELAYS_INSERTED');
    return out;
  }

  function fallbackPayload() {
    return { messages: [{ message: { text: CFG.fallbackMessage } }] };
  }

  function process(raw) {
    const rep = { repairs: [], warnings: [], errors: [], pending: [] };
    try {
      const c = coerceStructure(parseRecover(raw, rep), rep);
      if (c.fatal) throw new Error('raiz vazia');
      let payload = validatePayload(c.value, rep);
      payload = normalizeText(payload, rep);
      payload = rewriteImages(payload, rep);
      if (Array.isArray(payload.messages)) payload.messages = insertDelays(payload.messages, rep);
      return { ok: true, data: payload, report: rep };
    } catch (e) {
      rep.errors.push({ code: 'ERR_IRRECOVERABLE' });
      return { ok: false, data: fallbackPayload(), report: rep };
    }
  }
  return { process };
}

const MW = buildMiddleware(CONFIG);
return $input.all().map((it) => {
  let raw = (it.json || {})[CONFIG.inputField];
  if (raw != null && typeof raw !== 'string') raw = JSON.stringify(raw);
  const r = MW.process(raw);
  return { json: {
    [CONFIG.clientField]: CONFIG.stringifyClient ? JSON.stringify(r.data) : r.data,
    [CONFIG.debugField]: { ok: r.ok, report: r.report },
  } };
});
```
