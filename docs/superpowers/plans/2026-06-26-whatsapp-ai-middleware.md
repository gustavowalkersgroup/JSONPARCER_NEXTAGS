# whatsapp-ai-middleware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir uma biblioteca TS/JS que recebe a saída crua de um modelo de IA e devolve um JSON NexTags Messenger válido, normalizado e com delays sincronizados, mais um relatório de diagnóstico separado — sem nunca vazar diagnóstico ao cliente.

**Architecture:** Pipeline puro e síncrono de 9 estágios (extract → parse/repair → coerce → validate → normalize → image → delays → simulate → report). Núcleo offline e determinístico; I/O (proxy/probe de imagem) é injetável e opcional. O artefato de runtime é um bundle IIFE autossuficiente para Code node, com zod/jsonrepair inlinados.

**Tech Stack:** TypeScript strict, zod (validação), jsonrepair (fallback de parser), sharp (apenas no entry `/proxy`), Vitest + fast-check (testes), tsup/esbuild (build), ESLint + Prettier.

## Global Constraints

- **Node 20+**, TypeScript `strict: true`.
- **Núcleo sem I/O e sem dependências de plataforma.** Rede só via `ImageProbe` injetável; `sharp` só no entry `whatsapp-ai-middleware/proxy`.
- **Bundle de card** (`dist/card.global.js`): IIFE, `globalName: 'WAMW'`, **zero require externo** (zod e jsonrepair inlinados).
- **Anti-vazamento:** o campo do cliente recebe só `result.data` (stringificado); `report`/`simulation` vão para campo separado. Nunca concatenar.
- **Falha irrecuperável** nunca emite JSON quebrado ao cliente — sempre fallback seguro + handoff configurável.
- **Schema-alvo:** NexTags Messenger (raiz `messages`/`actions`; `attachment.type` ∈ `image,video,audio,file,template` e FORA de `payload`; carrossel ≥2; `web_url`→`url`, `postback`→`payload`; button template exige `text`; typing indicator inteiro 1–30; só JPEG/PNG; remover markdown-padrão, preservar WA-markup `*_~` e emojis; 8 ações canônicas).
- **Integridade (regra suprema):** nunca reassociar imagem↔template nem reordenar mensagens; só inserir delays e normalizar. Ambiguidade → warning.
- **Defaults de delay:** `intraCard=4`, `interProduct=7`, `bubble=4`; clamp `[1,30]`.
- **Códigos de diagnóstico** estáveis (enum `Codes`), nunca strings ad-hoc.
- **Commits frequentes**, mensagens com `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

```
package.json, tsconfig.json, tsup.config.ts, vitest.config.ts, .eslintrc.cjs, .prettierrc
src/
  index.ts                 // API pública
  types.ts                 // tipos do payload + Result/Report (derivados do zod)
  errors.ts                // Codes (enum) + Diagnostic helpers + classes de erro
  config/
    defaults.ts            // DEFAULT_OPTIONS
    resolve.ts             // resolveOptions(partial): ResolvedOptions
  parser/
    extract.ts             // extract(raw): string
    tokenizer.ts           // tokenize(s): Token[]
    parser.ts              // parseTokens(tokens): { value, repairs }
    repair.ts              // repairText(s): { text, repairs }
    fallback.ts            // parseRecover(raw, opts): { value, repairs }
  schema/
    schema.ts              // payloadSchema (zod) + subesquemas
    validate.ts            // validatePayload(value): { payload, diagnostics }
    actions.ts             // ACTION_ALIASES + canonicalizeActions
  normalize/
    structure.ts           // coerceStructure(value): { value, repairs }
    text.ts                // normalizeText(s, opts): { text, repairs }
  images/
    detect.ts              // detectFormat(buf), isWebp(buf), MAGIC
    url.ts                 // normalizeUrl(url, opts): string
    proxy.ts               // rewriteImageUrls(payload, opts), proxyUrl(base,url)
    probe.ts               // ImageProbe type
  delays/
    classify.ts            // classifyItems(messages): Item[]
    blocks.ts              // detectProducts(items): { products, diagnostics }
    insert.ts              // insertDelays(messages, opts): { messages, diagnostics }
  simulate/
    timeline.ts            // buildSimulation(payload, opts): Simulation
    stats.ts               // computeStats(payload, report): Stats
  report/
    report.ts              // createReport(): Report (+ push helpers)
  card/
    output.ts              // toCardOutput(result, opts)
  proxy/
    handler.ts             // createProxyHandler() — usa sharp
  core/
    pipeline.ts            // process(raw, options): Result
test/
  fixtures/broken/*.txt    // corpus de JSON quebrado
  fixtures/images/*        // bytes JPEG/PNG/WEBP
  **/*.test.ts
```

---

## Phase F0 — Scaffold, tipos, schema, config, erros

### Task F0.1: Scaffold do projeto e toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `tsup.config.ts`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`, `src/index.ts`, `test/smoke.test.ts`

**Interfaces:**
- Produces: scripts npm `build`, `test`, `typecheck`, `lint`; export vazio em `src/index.ts`.

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "whatsapp-ai-middleware",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "exports": {
    ".": { "import": "./dist/index.mjs", "require": "./dist/index.cjs", "types": "./dist/index.d.ts" },
    "./proxy": { "import": "./dist/proxy.mjs", "require": "./dist/proxy.cjs", "types": "./dist/proxy.d.ts" }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src test"
  },
  "dependencies": { "zod": "^3.23.8", "jsonrepair": "^3.8.0" },
  "optionalDependencies": { "sharp": "^0.33.0" },
  "devDependencies": {
    "typescript": "^5.5.0", "vitest": "^2.0.0", "fast-check": "^3.20.0",
    "tsup": "^8.2.0", "eslint": "^9.0.0", "prettier": "^3.3.0",
    "@types/node": "^20.14.0"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "declaration": true, "skipLibCheck": true, "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true, "outDir": "dist"
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Criar `tsup.config.ts`** (3 alvos: lib dual, proxy dual, card IIFE)

```ts
import { defineConfig } from 'tsup';
export default defineConfig([
  { entry: { index: 'src/index.ts' }, format: ['esm', 'cjs'], dts: true, clean: true, target: 'node20' },
  { entry: { proxy: 'src/proxy/handler.ts' }, format: ['esm', 'cjs'], dts: true, external: ['sharp'], target: 'node20' },
  { entry: { 'card.global': 'src/index.ts' }, format: ['iife'], globalName: 'WAMW',
    noExternal: ['zod', 'jsonrepair'], minify: true, platform: 'neutral', dts: false },
]);
```

- [ ] **Step 4: Criar `vitest.config.ts`, `.eslintrc.cjs`, `.prettierrc`, `.gitignore`**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
```
`.gitignore`: `node_modules`, `dist`, `*.log`.
`.prettierrc`: `{ "singleQuote": true, "printWidth": 100 }`.
`.eslintrc.cjs`: preset recomendado TS + Prettier (config mínima válida).

- [ ] **Step 5: Smoke test e `src/index.ts` stub**

```ts
// src/index.ts
export const VERSION = '0.1.0';
```
```ts
// test/smoke.test.ts
import { expect, test } from 'vitest';
import { VERSION } from '../src/index';
test('exports VERSION', () => { expect(VERSION).toBe('0.1.0'); });
```

- [ ] **Step 6: Instalar, rodar e commitar**

Run: `npm install && npm run typecheck && npm test`
Expected: smoke test PASS.
```bash
git add -A && git commit -m "chore: scaffold whatsapp-ai-middleware (F0.1)"
```

---

### Task F0.2: Tipos do payload e do resultado (`types.ts`)

**Files:**
- Create: `src/types.ts`, `test/types.test.ts`

**Interfaces:**
- Produces: `NexTagsPayload`, `MessageItem`, `Message`, `Attachment`, `TemplatePayload`, `Button`, `Action`, `Result`, `Report`, `Stats`, `Diagnostic`, `Repair`, `Warning`, `ProcessError`, `Pending`, `Simulation`, `TimelineEntry`, `TransitionType`, `ImageProbe`, `MiddlewareOptions`, `ResolvedOptions`.

- [ ] **Step 1: Escrever os tipos** (estes são o contrato de todo o resto)

```ts
// src/types.ts
export type ItemType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'TEMPLATE' | 'DELAY';
export type TransitionType =
  | 'intraCard' | 'interProduct' | 'textToMedia' | 'mediaToText' | 'textToText' | 'default';

export interface Button { type: 'web_url' | 'postback'; title: string; url?: string; payload?: string; }
export interface TemplateElement { title: string; subtitle?: string; image_url?: string; buttons?: Button[]; }
export interface TemplatePayload {
  template_type: 'generic' | 'button';
  text?: string; image_aspect_ratio?: 'horizontal' | 'square';
  elements?: TemplateElement[]; buttons?: Button[];
}
export interface Attachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'template';
  payload: { url?: string } & Partial<TemplatePayload>;
}
export interface Message { text?: string; attachment?: Attachment; }
export type MessageItem = { message: Message } | number;
export interface Action { action: string; [k: string]: unknown; }
export interface NexTagsPayload { messages?: MessageItem[]; actions?: Action[]; }

export type DiagnosticKind = 'repair' | 'warning' | 'error' | 'pending';
export interface Diagnostic { code: string; message: string; path?: string; detail?: unknown; fatal?: boolean; }
export type Repair = Diagnostic; export type Warning = Diagnostic;
export type ProcessError = Diagnostic; export type Pending = Diagnostic;

export interface Stats {
  totalDurationSec: number; productCount: number; imageCount: number;
  messageCount: number; delayCount: number; repairCount: number;
  warningCount: number; errorCount: number; pendingCount: number;
}
export interface Report { repairs: Repair[]; warnings: Warning[]; errors: ProcessError[]; pending: Pending[]; stats: Stats; }
export interface TimelineEntry { atSec: number; icon: string; kind: ItemType; label: string; }
export interface Simulation { timeline: TimelineEntry[]; render(): string; stats: Stats; }
export interface Result { ok: boolean; data?: NexTagsPayload; report: Report; simulation?: Simulation; }

export type ImageProbe = (url: string) => Promise<{ contentType: string }>;
export type Handoff =
  | { action: 'send_flow'; flow_id: string }
  | { action: 'transfer_conversation_to'; value: 'human' }
  | null;

export interface MiddlewareOptions {
  image?: { strategy?: 'proxy' | 'detect-only'; proxyBase?: string; stripQuery?: boolean;
            removeUnverifiable?: boolean; probe?: ImageProbe; };
  delays?: { intraCard?: number; interProduct?: number; bubble?: number; min?: number; max?: number;
             perTransition?: Partial<Record<TransitionType, number>>; };
  fallback?: { message?: string; handoff?: Handoff };
  normalize?: { stripStandardMarkdown?: boolean; preserveWhatsappMarkup?: boolean; straightenQuotes?: boolean };
  parser?: { useFallbackLibrary?: boolean; maxRepairPasses?: number };
  simulate?: boolean;
  report?: { level?: 'silent' | 'error' | 'warn' | 'info' | 'debug' };
}
export type ResolvedOptions = Required<{
  image: Required<Omit<NonNullable<MiddlewareOptions['image']>, 'probe'>> & { probe?: ImageProbe };
  delays: Required<Omit<NonNullable<MiddlewareOptions['delays']>, 'perTransition'>> & { perTransition: Partial<Record<TransitionType, number>> };
  fallback: Required<NonNullable<MiddlewareOptions['fallback']>>;
  normalize: Required<NonNullable<MiddlewareOptions['normalize']>>;
  parser: Required<NonNullable<MiddlewareOptions['parser']>>;
  simulate: boolean;
  report: Required<NonNullable<MiddlewareOptions['report']>>;
}>;
```

- [ ] **Step 2: Teste de compilação de tipos**

```ts
// test/types.test.ts
import { expect, test } from 'vitest';
import type { NexTagsPayload, Result } from '../src/types';
test('payload type accepts canonical shape', () => {
  const p: NexTagsPayload = { messages: [{ message: { text: 'oi' } }, 4], actions: [{ action: 'add_tag', tag_name: 'x' }] };
  expect(p.messages?.length).toBe(2);
});
```

- [ ] **Step 3: typecheck + test + commit**

Run: `npm run typecheck && npm test`
Expected: PASS.
```bash
git add -A && git commit -m "feat: tipos do payload e do resultado (F0.2)"
```

---

### Task F0.3: Códigos de diagnóstico e erros (`errors.ts`)

**Files:**
- Create: `src/errors.ts`, `test/errors.test.ts`

**Interfaces:**
- Produces: `Codes` (objeto const), `IrrecoverableError` (class), helpers `diag(kind, code, message, extra?)`.

- [ ] **Step 1: Test (códigos estáveis + classe de erro)**

```ts
// test/errors.test.ts
import { expect, test } from 'vitest';
import { Codes, IrrecoverableError } from '../src/errors';
test('codes are stable strings', () => { expect(Codes.ERR_IRRECOVERABLE_JSON).toBe('ERR_IRRECOVERABLE_JSON'); });
test('IrrecoverableError carries code', () => {
  const e = new IrrecoverableError('boom', 'ERR_IRRECOVERABLE_JSON');
  expect(e.code).toBe('ERR_IRRECOVERABLE_JSON'); expect(e instanceof Error).toBe(true);
});
```

- [ ] **Step 2: Implementação**

```ts
// src/errors.ts
import type { Diagnostic, DiagnosticKind } from './types';
export const Codes = {
  ERR_IRRECOVERABLE_JSON: 'ERR_IRRECOVERABLE_JSON',
  ERR_ROOT_EMPTY: 'ERR_ROOT_EMPTY',
  ERR_INVALID_ATTACHMENT_TYPE: 'ERR_INVALID_ATTACHMENT_TYPE',
  ERR_CAROUSEL_TOO_SMALL: 'ERR_CAROUSEL_TOO_SMALL',
  ERR_BUTTON_MISSING_FIELD: 'ERR_BUTTON_MISSING_FIELD',
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
  WARN_BLOCK_AMBIGUOUS: 'WARN_BLOCK_AMBIGUOUS',
  WARN_MULTIPLE_WEB_URL: 'WARN_MULTIPLE_WEB_URL',
  WARN_CTA_TOO_LONG: 'WARN_CTA_TOO_LONG',
  WARN_NON_CANONICAL_HANDOFF: 'WARN_NON_CANONICAL_HANDOFF',
  PENDING_IMAGE_UNVERIFIABLE: 'PENDING_IMAGE_UNVERIFIABLE',
  PENDING_BUTTON_MISSING_TEXT: 'PENDING_BUTTON_MISSING_TEXT',
  PENDING_DIRTY_ADMIN_ID: 'PENDING_DIRTY_ADMIN_ID',
  PENDING_LEGACY_ACTION: 'PENDING_LEGACY_ACTION',
} as const;
export type Code = (typeof Codes)[keyof typeof Codes];

export class IrrecoverableError extends Error {
  constructor(message: string, public readonly code: Code, public readonly detail?: unknown) {
    super(message); this.name = 'IrrecoverableError';
  }
}
export function diag(code: Code, message: string, extra?: Partial<Diagnostic>): Diagnostic {
  return { code, message, ...extra };
}
export const KIND_BY_PREFIX: Record<string, DiagnosticKind> = {
  ERR: 'error', REPAIR: 'repair', WARN: 'warning', PENDING: 'pending',
};
```

- [ ] **Step 3: test + commit**

Run: `npm test`
Expected: PASS.
```bash
git add -A && git commit -m "feat: codigos de diagnostico e erros (F0.3)"
```

---

### Task F0.4: Report builder (`report/report.ts`)

**Files:**
- Create: `src/report/report.ts`, `test/report.test.ts`

**Interfaces:**
- Consumes: `Codes`, `diag`, `KIND_BY_PREFIX`, tipos `Report`, `Diagnostic`.
- Produces: `createReport(): ReportBuilder`; `ReportBuilder` com `push(d: Diagnostic)`, `repairs/warnings/errors/pending` arrays, `finalize(stats): Report`.

- [ ] **Step 1: Test**

```ts
// test/report.test.ts
import { expect, test } from 'vitest';
import { createReport } from '../src/report/report';
import { Codes, diag } from '../src/errors';
test('routes diagnostics by code prefix', () => {
  const r = createReport();
  r.push(diag(Codes.REPAIR_FENCE_STRIPPED, 'x'));
  r.push(diag(Codes.WARN_BLOCK_AMBIGUOUS, 'y'));
  r.push(diag(Codes.PENDING_IMAGE_UNVERIFIABLE, 'z'));
  r.push(diag(Codes.ERR_ROOT_EMPTY, 'w'));
  expect(r.repairs.length).toBe(1); expect(r.warnings.length).toBe(1);
  expect(r.pending.length).toBe(1); expect(r.errors.length).toBe(1);
});
```

- [ ] **Step 2: Implementação**

```ts
// src/report/report.ts
import type { Diagnostic, Report, Stats } from '../types';
import { KIND_BY_PREFIX } from '../errors';
export interface ReportBuilder {
  repairs: Diagnostic[]; warnings: Diagnostic[]; errors: Diagnostic[]; pending: Diagnostic[];
  push(d: Diagnostic): void; finalize(stats: Stats): Report;
}
export function createReport(): ReportBuilder {
  const b: ReportBuilder = {
    repairs: [], warnings: [], errors: [], pending: [],
    push(d) {
      const kind = KIND_BY_PREFIX[d.code.split('_')[0] ?? ''] ?? 'warning';
      ({ repair: b.repairs, warning: b.warnings, error: b.errors, pending: b.pending })[kind].push(d);
    },
    finalize(stats) { return { repairs: b.repairs, warnings: b.warnings, errors: b.errors, pending: b.pending, stats }; },
  };
  return b;
}
```

- [ ] **Step 3: test + commit**

Run: `npm test` → PASS.
```bash
git add -A && git commit -m "feat: report builder roteando por prefixo de codigo (F0.4)"
```

---

### Task F0.5: Config defaults + resolve (`config/`)

**Files:**
- Create: `src/config/defaults.ts`, `src/config/resolve.ts`, `test/config.test.ts`

**Interfaces:**
- Consumes: `MiddlewareOptions`, `ResolvedOptions`.
- Produces: `DEFAULT_OPTIONS: ResolvedOptions`; `resolveOptions(opts?: MiddlewareOptions): ResolvedOptions`.

- [ ] **Step 1: Test**

```ts
// test/config.test.ts
import { expect, test } from 'vitest';
import { resolveOptions } from '../src/config/resolve';
test('applies defaults and deep-merges', () => {
  const o = resolveOptions({ delays: { interProduct: 9 } });
  expect(o.delays.intraCard).toBe(4); expect(o.delays.interProduct).toBe(9);
  expect(o.image.strategy).toBe('proxy'); expect(o.fallback.message).toContain('instante');
});
```

- [ ] **Step 2: Implementação**

```ts
// src/config/defaults.ts
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
```
```ts
// src/config/resolve.ts
import type { MiddlewareOptions, ResolvedOptions } from '../types';
import { DEFAULT_OPTIONS } from './defaults';
export function resolveOptions(o: MiddlewareOptions = {}): ResolvedOptions {
  const d = DEFAULT_OPTIONS;
  return {
    image: { ...d.image, ...o.image },
    delays: { ...d.delays, ...o.delays, perTransition: { ...d.delays.perTransition, ...o.delays?.perTransition } },
    fallback: { ...d.fallback, ...o.fallback },
    normalize: { ...d.normalize, ...o.normalize },
    parser: { ...d.parser, ...o.parser },
    simulate: o.simulate ?? d.simulate,
    report: { ...d.report, ...o.report },
  };
}
```

- [ ] **Step 3: test + commit**

Run: `npm test` → PASS.
```bash
git add -A && git commit -m "feat: config defaults e resolveOptions (F0.5)"
```

**Phase F0 deliverable:** projeto compila, testa e tem o contrato de tipos, erros, report e config. Limitações: nenhuma lógica de pipeline ainda.

---

## Phase F1 — Parser híbrido + reparo (Problema 1)

### Task F1.1: `extract.ts` — desencapsular fence/prosa

**Files:** Create `src/parser/extract.ts`, `test/parser/extract.test.ts`

**Interfaces:**
- Produces: `extract(raw: string): { text: string; repairs: Diagnostic[] }`.

- [ ] **Step 1: Test**

```ts
// test/parser/extract.test.ts
import { expect, test } from 'vitest';
import { extract } from '../../src/parser/extract';
test('strips json fence and surrounding prose', () => {
  const r = extract('Claro!\n```json\n{"messages":[]}\n```\nEspero ter ajudado.');
  expect(r.text).toBe('{"messages":[]}'); expect(r.repairs.some(d => d.code === 'REPAIR_FENCE_STRIPPED')).toBe(true);
});
test('isolates outermost object ignoring braces in strings', () => {
  expect(extract('{"messages":[{"message":{"text":"a } b"}}]}').text).toContain('a } b');
});
test('returns raw when no object found', () => { expect(extract('sem json').text).toBe('sem json'); });
```

- [ ] **Step 2: Implementação** (balanceamento respeitando strings)

```ts
// src/parser/extract.ts
import type { Diagnostic } from '../types';
import { Codes, diag } from '../errors';
export function extract(raw: string): { text: string; repairs: Diagnostic[] } {
  const repairs: Diagnostic[] = [];
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence?.[1]) { s = fence[1].trim(); repairs.push(diag(Codes.REPAIR_FENCE_STRIPPED, 'Removida cerca markdown')); }
  const start = s.indexOf('{');
  if (start === -1) return { text: s, repairs };
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const text = end === -1 ? s.slice(start) : s.slice(start, end + 1);
  return { text, repairs };
}
```

- [ ] **Step 3: test + commit** → `feat: extract desencapsula fence/prosa (F1.1)`

---

### Task F1.2: `repair.ts` — reparos de texto (aspas, trailing comma)

**Files:** Create `src/parser/repair.ts`, `test/parser/repair.test.ts`

**Interfaces:**
- Produces: `repairText(s: string): { text: string; repairs: Diagnostic[] }`.

- [ ] **Step 1: Test**

```ts
// test/parser/repair.test.ts
import { expect, test } from 'vitest';
import { repairText } from '../../src/parser/repair';
test('straightens smart quotes', () => {
  const r = repairText('{“messages”:[]}');
  expect(r.text).toBe('{"messages":[]}'); expect(r.repairs.some(d => d.code === 'REPAIR_SMART_QUOTES')).toBe(true);
});
test('removes trailing commas', () => {
  expect(repairText('{"a":[1,2,],}').text).toBe('{"a":[1,2]}');
});
```

- [ ] **Step 2: Implementação** (atua só fora de strings para aspas tipográficas; trailing comma por varredura)

```ts
// src/parser/repair.ts
import type { Diagnostic } from '../types';
import { Codes, diag } from '../errors';
export function repairText(input: string): { text: string; repairs: Diagnostic[] } {
  const repairs: Diagnostic[] = [];
  let s = input;
  if (/[“”‘’]/.test(s)) {
    s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    repairs.push(diag(Codes.REPAIR_SMART_QUOTES, 'Aspas tipográficas normalizadas'));
  }
  // trailing comma antes de } ou ] (fora de string), varredura char-a-char
  let out = '', inStr = false, esc = false, changed = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ',') {
      let j = i + 1; while (j < s.length && /\s/.test(s[j]!)) j++;
      if (s[j] === '}' || s[j] === ']') { changed = true; continue; }
    }
    out += c;
  }
  if (changed) repairs.push(diag(Codes.REPAIR_TRAILING_COMMA, 'Vírgula final removida'));
  return { text: out, repairs };
}
```

- [ ] **Step 3: test + commit** → `feat: repair de texto (aspas, trailing comma) (F1.2)`

---

### Task F1.3: `tokenizer.ts` — tokenizer tolerante

**Files:** Create `src/parser/tokenizer.ts`, `test/parser/tokenizer.test.ts`

**Interfaces:**
- Produces: `Token` (`{ kind: 'lbrace'|'rbrace'|'lbracket'|'rbracket'|'colon'|'comma'|'string'|'number'|'true'|'false'|'null'; value?: string|number|boolean|null; pos: number }`), `tokenize(s: string): Token[]`.

- [ ] **Step 1: Test**

```ts
// test/parser/tokenizer.test.ts
import { expect, test } from 'vitest';
import { tokenize } from '../../src/parser/tokenizer';
test('tokenizes object with string and number', () => {
  const t = tokenize('{"a":4}');
  expect(t.map(x => x.kind)).toEqual(['lbrace','string','colon','number','rbrace']);
  expect(t[1]!.value).toBe('a'); expect(t[3]!.value).toBe(4);
});
test('accepts single-quoted strings', () => { expect(tokenize("{'a':1}")[1]!.value).toBe('a'); });
```

- [ ] **Step 2: Implementação** (suporta `"` e `'`, números, literais, ignora espaços)

```ts
// src/parser/tokenizer.ts
export type TokenKind = 'lbrace'|'rbrace'|'lbracket'|'rbracket'|'colon'|'comma'|'string'|'number'|'true'|'false'|'null';
export interface Token { kind: TokenKind; value?: string | number | boolean | null; pos: number; }
export function tokenize(s: string): Token[] {
  const t: Token[] = []; let i = 0;
  const single: Record<string, TokenKind> = { '{': 'lbrace', '}': 'rbrace', '[': 'lbracket', ']': 'rbracket', ':': 'colon', ',': 'comma' };
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (single[c]) { t.push({ kind: single[c]!, pos: i }); i++; continue; }
    if (c === '"' || c === "'") {
      const q = c; let j = i + 1, str = '';
      while (j < s.length) { const d = s[j]!; if (d === '\\') { str += d + (s[j+1] ?? ''); j += 2; continue; } if (d === q) break; str += d; j++; }
      let val: string; try { val = JSON.parse('"' + str.replace(/\\'/g, "'").replace(/"/g, '\\"') + '"'); } catch { val = str; }
      t.push({ kind: 'string', value: val, pos: i }); i = j + 1; continue;
    }
    const num = s.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (num) { t.push({ kind: 'number', value: Number(num[0]), pos: i }); i += num[0].length; continue; }
    const lit = s.slice(i).match(/^(true|false|null)/);
    if (lit) { const v = lit[0]; t.push({ kind: v as TokenKind, value: v === 'true' ? true : v === 'false' ? false : null, pos: i }); i += v.length; continue; }
    i++; // caractere inesperado: ignora (tolerância)
  }
  return t;
}
```

- [ ] **Step 3: test + commit** → `feat: tokenizer tolerante (F1.3)`

---

### Task F1.4: `parser.ts` — recursive-descent com recuperação

**Files:** Create `src/parser/parser.ts`, `test/parser/parser.test.ts`

**Interfaces:**
- Consumes: `Token`, `tokenize`.
- Produces: `parseTokens(tokens: Token[]): { value: unknown; repairs: Diagnostic[] }` (auto-fecha estruturas truncadas, insere vírgulas faltantes).

- [ ] **Step 1: Test (incluindo truncamento)**

```ts
// test/parser/parser.test.ts
import { expect, test } from 'vitest';
import { tokenize } from '../../src/parser/tokenizer';
import { parseTokens } from '../../src/parser/parser';
const p = (s: string) => parseTokens(tokenize(s));
test('parses valid object', () => { expect(p('{"a":[1,2]}').value).toEqual({ a: [1, 2] }); });
test('auto-closes truncated object', () => {
  const r = p('{"messages":[{"message":{"text":"oi"');
  expect((r.value as any).messages[0].message.text).toBe('oi');
  expect(r.repairs.some(d => d.code === 'REPAIR_AUTOCLOSED')).toBe(true);
});
test('inserts missing comma between members', () => {
  expect(p('{"a":1 "b":2}').value).toEqual({ a: 1, b: 2 });
});
```

- [ ] **Step 2: Implementação**

```ts
// src/parser/parser.ts
import type { Diagnostic } from '../types';
import { Codes, diag, IrrecoverableError } from '../errors';
import type { Token } from './tokenizer';
export function parseTokens(tokens: Token[]): { value: unknown; repairs: Diagnostic[] } {
  const repairs: Diagnostic[] = []; let i = 0;
  const peek = () => tokens[i]; const next = () => tokens[i++];
  const eof = () => i >= tokens.length;
  function parseValue(): unknown {
    const t = peek();
    if (!t) { repairs.push(diag(Codes.REPAIR_AUTOCLOSED, 'EOF inesperado: valor nulo assumido')); return null; }
    switch (t.kind) {
      case 'lbrace': return parseObject();
      case 'lbracket': return parseArray();
      case 'string': case 'number': case 'true': case 'false': case 'null': next(); return t.value;
      default: next(); return null;
    }
  }
  function parseObject(): Record<string, unknown> {
    next(); const obj: Record<string, unknown> = {};
    while (!eof()) {
      let t = peek(); if (!t) break;
      if (t.kind === 'rbrace') { next(); return obj; }
      if (t.kind === 'comma') { next(); continue; }
      if (t.kind !== 'string') { next(); continue; }
      const key = String(next()!.value);
      if (peek()?.kind === 'colon') next(); // tolera colon faltando
      obj[key] = parseValue();
      const after = peek();
      if (after && after.kind !== 'comma' && after.kind !== 'rbrace') repairs.push(diag(Codes.REPAIR_MISSING_COMMA, 'Vírgula inserida'));
    }
    repairs.push(diag(Codes.REPAIR_AUTOCLOSED, 'Objeto truncado auto-fechado')); return obj;
  }
  function parseArray(): unknown[] {
    next(); const arr: unknown[] = [];
    while (!eof()) {
      const t = peek(); if (!t) break;
      if (t.kind === 'rbracket') { next(); return arr; }
      if (t.kind === 'comma') { next(); continue; }
      arr.push(parseValue());
    }
    repairs.push(diag(Codes.REPAIR_AUTOCLOSED, 'Array truncado auto-fechado')); return arr;
  }
  if (eof()) throw new IrrecoverableError('Sem tokens para parsear', Codes.ERR_IRRECOVERABLE_JSON);
  const value = parseValue();
  return { value, repairs };
}
```

- [ ] **Step 3: test + commit** → `feat: parser recursive-descent com recuperacao (F1.4)`

---

### Task F1.5: `fallback.ts` — orquestra extract→repair→parse→jsonrepair

**Files:** Create `src/parser/fallback.ts`, `test/parser/fallback.test.ts`

**Interfaces:**
- Consumes: `extract`, `repairText`, `tokenize`, `parseTokens`, `ResolvedOptions`.
- Produces: `parseRecover(raw: string, opts: ResolvedOptions): { value: unknown; repairs: Diagnostic[] }` (lança `IrrecoverableError` se tudo falhar).

- [ ] **Step 1: Test**

```ts
// test/parser/fallback.test.ts
import { expect, test } from 'vitest';
import { parseRecover } from '../../src/parser/fallback';
import { resolveOptions } from '../../src/config/resolve';
import { IrrecoverableError } from '../../src/errors';
const o = resolveOptions();
test('recovers fenced + truncated', () => {
  const r = parseRecover('```json\n{"messages":[{"message":{"text":"oi"', o);
  expect((r.value as any).messages[0].message.text).toBe('oi');
});
test('throws on pure garbage', () => { expect(() => parseRecover('????', o)).toThrow(IrrecoverableError); });
```

- [ ] **Step 2: Implementação**

```ts
// src/parser/fallback.ts
import type { Diagnostic, ResolvedOptions } from '../types';
import { Codes, diag, IrrecoverableError } from '../errors';
import { extract } from './extract';
import { repairText } from './repair';
import { tokenize } from './tokenizer';
import { parseTokens } from './parser';
import { jsonrepair } from 'jsonrepair';
export function parseRecover(raw: string, opts: ResolvedOptions): { value: unknown; repairs: Diagnostic[] } {
  const repairs: Diagnostic[] = [];
  const ex = extract(raw); repairs.push(...ex.repairs);
  const rep = repairText(ex.text); repairs.push(...rep.repairs);
  // tentativa estrita primeiro (rápida)
  try { return { value: JSON.parse(rep.text), repairs }; } catch { /* segue */ }
  // parser tolerante próprio
  try {
    const r = parseTokens(tokenize(rep.text));
    if (r.value && typeof r.value === 'object') return { value: r.value, repairs: [...repairs, ...r.repairs] };
  } catch { /* segue */ }
  // fallback de biblioteca
  if (opts.parser.useFallbackLibrary) {
    try { const v = JSON.parse(jsonrepair(rep.text)); repairs.push(diag(Codes.REPAIR_FALLBACK_LIB, 'Recuperado via jsonrepair')); return { value: v, repairs }; }
    catch { /* segue */ }
  }
  throw new IrrecoverableError('JSON irrecuperável', Codes.ERR_IRRECOVERABLE_JSON, { raw });
}
```

- [ ] **Step 3: test + commit** → `feat: parseRecover hibrido com fallback jsonrepair (F1.5)`

**Phase F1 deliverable:** recuperação de JSON malformado completa. Limitações: ainda não valida nem coage estrutura ao schema.

---

## Phase F2 — Validação + coerção estrutural

### Task F2.1: `schema/actions.ts` — aliases canônicos

**Files:** Create `src/schema/actions.ts`, `test/schema/actions.test.ts`

**Interfaces:**
- Produces: `ACTION_ALIASES: Record<string,string>`, `CANONICAL_ACTIONS: Set<string>`, `canonicalizeActions(actions: Action[]): { actions: Action[]; diagnostics: Diagnostic[] }`.

- [ ] **Step 1: Test**

```ts
// test/schema/actions.test.ts
import { expect, test } from 'vitest';
import { canonicalizeActions } from '../../src/schema/actions';
test('maps addTag to add_tag (repair)', () => {
  const r = canonicalizeActions([{ action: 'addTag', tag_name: 'x' }]);
  expect(r.actions[0]!.action).toBe('add_tag');
  expect(r.diagnostics.some(d => d.code === 'REPAIR_ACTION_ALIAS')).toBe(true);
});
test('flags legacy Rotativo() as pending', () => {
  const r = canonicalizeActions([{ action: 'Rotativo()' }]);
  expect(r.diagnostics.some(d => d.code === 'PENDING_LEGACY_ACTION')).toBe(true);
});
test('dirty admin_id is pending', () => {
  const r = canonicalizeActions([{ action: 'assign_conversation', admin_id: 'Estela.' }]);
  expect(r.diagnostics.some(d => d.code === 'PENDING_DIRTY_ADMIN_ID')).toBe(true);
});
```

- [ ] **Step 2: Implementação** (tabela de aliases completa do schema §Aliases; pendência p/ legado e `admin_id` sujo; warning p/ handoff não-canônico)

```ts
// src/schema/actions.ts
import type { Action, Diagnostic } from '../types';
import { Codes, diag } from '../errors';
export const ACTION_ALIASES: Record<string, string> = {
  addtag: 'add_tag', 'add-tag': 'add_tag', tag_add: 'add_tag',
  removetag: 'remove_tag', 'remove-tag': 'remove_tag', tag_remove: 'remove_tag',
  setfield: 'set_field_value', set_field: 'set_field_value', setfieldvalue: 'set_field_value',
  unsetfield: 'unset_field_value', clear_field: 'unset_field_value', unsetfieldvalue: 'unset_field_value',
  sendflow: 'send_flow', 'send-flow': 'send_flow', trigger_flow: 'send_flow', flow: 'send_flow',
  transfer: 'transfer_conversation_to', transfer_to_human: 'transfer_conversation_to', transferhuman: 'transfer_conversation_to',
  assign: 'assign_conversation', assignto: 'assign_conversation', assign_to: 'assign_conversation',
  unassign: 'unassign_conversation', unassign_admin: 'unassign_conversation',
};
export const CANONICAL_ACTIONS = new Set([
  'add_tag','remove_tag','set_field_value','unset_field_value','send_flow',
  'transfer_conversation_to','assign_conversation','unassign_conversation',
]);
const LEGACY = /\(\)|\{\{|\}\}/;
export function canonicalizeActions(actions: Action[]): { actions: Action[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []; const out: Action[] = [];
  for (const a of actions) {
    const name = String(a.action ?? '');
    if (LEGACY.test(name)) { diagnostics.push(diag(Codes.PENDING_LEGACY_ACTION, `Ação legada removida: ${name}`)); continue; }
    const key = name.toLowerCase().replace(/[\s]/g, '');
    let canon = CANONICAL_ACTIONS.has(name) ? name : ACTION_ALIASES[key];
    if (canon && canon !== name) { diagnostics.push(diag(Codes.REPAIR_ACTION_ALIAS, `${name} → ${canon}`)); }
    const action = { ...a, action: canon ?? name };
    if (action.action === 'transfer_conversation_to' || action.action === 'assign_conversation')
      diagnostics.push(diag(Codes.WARN_NON_CANONICAL_HANDOFF, 'Padrão de handoff recomendado é send_flow'));
    if (action.action === 'assign_conversation' && !/^[\w-]+$/.test(String(action.admin_id ?? '')))
      diagnostics.push(diag(Codes.PENDING_DIRTY_ADMIN_ID, `admin_id inválido: ${String(action.admin_id)}`));
    out.push(action);
  }
  return { actions: out, diagnostics };
}
```

- [ ] **Step 3: test + commit** → `feat: canonicalizacao de acoes (F2.1)`

---

### Task F2.2: `normalize/structure.ts` — shape raiz + type fora do payload

**Files:** Create `src/normalize/structure.ts`, `test/normalize/structure.test.ts`

**Interfaces:**
- Consumes: `canonicalizeActions`.
- Produces: `coerceStructure(value: unknown): { value: NexTagsPayload; diagnostics: Diagnostic[]; fatal: boolean }`.

- [ ] **Step 1: Test**

```ts
// test/normalize/structure.test.ts
import { expect, test } from 'vitest';
import { coerceStructure } from '../../src/normalize/structure';
test('moves attachment.type out of payload', () => {
  const r = coerceStructure({ messages: [{ message: { attachment: { payload: { type: 'image', url: 'u' } } } }] });
  const att = (r.value.messages![0] as any).message.attachment;
  expect(att.type).toBe('image'); expect(att.payload.type).toBeUndefined();
  expect(r.diagnostics.some(d => d.code === 'REPAIR_TYPE_MOVED_OUT_OF_PAYLOAD')).toBe(true);
});
test('empty root is fatal', () => {
  const r = coerceStructure({}); expect(r.fatal).toBe(true);
  expect(r.diagnostics.some(d => d.code === 'ERR_ROOT_EMPTY')).toBe(true);
});
```

- [ ] **Step 2: Implementação**

```ts
// src/normalize/structure.ts
import type { Action, Diagnostic, MessageItem, NexTagsPayload } from '../types';
import { Codes, diag } from '../errors';
import { canonicalizeActions } from '../schema/actions';
export function coerceStructure(value: unknown): { value: NexTagsPayload; diagnostics: Diagnostic[]; fatal: boolean } {
  const diagnostics: Diagnostic[] = [];
  const v = (value && typeof value === 'object') ? (value as Record<string, unknown>) : {};
  const messages = Array.isArray(v.messages) ? (v.messages as MessageItem[]) : undefined;
  let actions = Array.isArray(v.actions) ? (v.actions as Action[]) : undefined;
  if (messages) for (const item of messages) {
    if (typeof item === 'number') continue;
    const att = item?.message?.attachment as any;
    if (att?.payload && typeof att.payload === 'object' && att.payload.type && !att.type) {
      att.type = att.payload.type; delete att.payload.type;
      diagnostics.push(diag(Codes.REPAIR_TYPE_MOVED_OUT_OF_PAYLOAD, 'attachment.type movido para fora do payload'));
    }
  }
  if (actions) { const c = canonicalizeActions(actions); actions = c.actions; diagnostics.push(...c.diagnostics); }
  const hasMsg = !!messages && messages.length > 0;
  const hasAct = !!actions && actions.length > 0;
  const fatal = !hasMsg && !hasAct;
  if (fatal) diagnostics.push(diag(Codes.ERR_ROOT_EMPTY, 'Raiz sem messages nem actions', { fatal: true }));
  const out: NexTagsPayload = {};
  if (messages) out.messages = messages;
  if (actions) out.actions = actions;
  return { value: out, diagnostics, fatal };
}
```

- [ ] **Step 3: test + commit** → `feat: coercao estrutural (type fora do payload, shape raiz) (F2.2)`

---

### Task F2.3: `schema/schema.ts` + `schema/validate.ts` — zod

**Files:** Create `src/schema/schema.ts`, `src/schema/validate.ts`, `test/schema/validate.test.ts`

**Interfaces:**
- Produces: `payloadSchema` (zod); `validatePayload(value: NexTagsPayload): { payload: NexTagsPayload; diagnostics: Diagnostic[] }` — remove itens inválidos (botão sem campo, carrossel <2), emite warnings (>1 web_url, CTA>20), pendência (button sem text), clamp de typing.

- [ ] **Step 1: Test**

```ts
// test/schema/validate.test.ts
import { expect, test } from 'vitest';
import { validatePayload } from '../../src/schema/validate';
test('removes web_url button without url', () => {
  const r = validatePayload({ messages: [{ message: { attachment: { type: 'template', payload: { template_type: 'button', text: 't', buttons: [{ type: 'web_url', title: 'x' }] } } } }] });
  const btns = (r.payload.messages![0] as any).message.attachment.payload.buttons;
  expect(btns.length).toBe(0); expect(r.diagnostics.some(d => d.code === 'ERR_BUTTON_MISSING_FIELD')).toBe(true);
});
test('clamps typing indicator out of range', () => {
  const r = validatePayload({ messages: [{ message: { text: 'a' } }, 99, { message: { text: 'b' } }] });
  expect(r.payload.messages![1]).toBe(30);
  expect(r.diagnostics.some(d => d.code === 'REPAIR_TYPING_CLAMPED')).toBe(true);
});
test('flags carousel with <2 elements', () => {
  const r = validatePayload({ messages: [{ message: { attachment: { type: 'template', payload: { template_type: 'generic', elements: [{ title: 'só um' }] } } } }] });
  expect(r.diagnostics.some(d => d.code === 'ERR_CAROUSEL_TOO_SMALL')).toBe(true);
});
```

- [ ] **Step 2: Implementação do schema zod** (`schema.ts`) e do validador imperativo (`validate.ts`)

`schema.ts`: define `buttonSchema`, `templatePayloadSchema`, `attachmentSchema`, `messageSchema`, `messageItemSchema` (union objeto|inteiro 1–30), `actionSchema`, `payloadSchema`. Usado para checagem de tipos e como fonte de `z.infer` (mas a validação corretiva fica no `validate.ts`, que conserta em vez de rejeitar).

```ts
// src/schema/validate.ts
import type { Diagnostic, MessageItem, NexTagsPayload, Button } from '../types';
import { Codes, diag } from '../errors';
const VALID_ATTACH = new Set(['image','video','audio','file','template']);
function fixButtons(buttons: Button[], diagnostics: Diagnostic[]): Button[] {
  let webUrlCount = 0;
  return buttons.filter(b => {
    if (b.type === 'web_url' && !b.url) { diagnostics.push(diag(Codes.ERR_BUTTON_MISSING_FIELD, 'web_url sem url')); return false; }
    if (b.type === 'postback' && !b.payload) { diagnostics.push(diag(Codes.ERR_BUTTON_MISSING_FIELD, 'postback sem payload')); return false; }
    if (b.type === 'web_url' && ++webUrlCount > 1) { diagnostics.push(diag(Codes.WARN_MULTIPLE_WEB_URL, '>1 botão web_url')); return false; }
    if (b.title && b.title.length > 20) diagnostics.push(diag(Codes.WARN_CTA_TOO_LONG, `CTA >20: ${b.title}`));
    return true;
  });
}
export function validatePayload(payload: NexTagsPayload): { payload: NexTagsPayload; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const messages = payload.messages?.map((item: MessageItem): MessageItem | null => {
    if (typeof item === 'number') {
      const n = Math.round(item);
      if (n < 1 || n > 30) { diagnostics.push(diag(Codes.REPAIR_TYPING_CLAMPED, `typing ${item} fora de 1–30`)); return Math.min(30, Math.max(1, n)); }
      return n;
    }
    const att = item.message?.attachment;
    if (att) {
      if (!VALID_ATTACH.has(att.type)) { diagnostics.push(diag(Codes.ERR_INVALID_ATTACHMENT_TYPE, `type inválido: ${att.type}`)); return null; }
      if (att.type === 'template') {
        const p = att.payload as any;
        if (p.template_type === 'generic') {
          if (!Array.isArray(p.elements) || p.elements.length < 2) { diagnostics.push(diag(Codes.ERR_CAROUSEL_TOO_SMALL, 'carrossel <2')); return null; }
        }
        if (p.template_type === 'button') {
          if (!p.text) diagnostics.push(diag(Codes.PENDING_BUTTON_MISSING_TEXT, 'button sem text'));
          if (Array.isArray(p.buttons)) p.buttons = fixButtons(p.buttons, diagnostics);
        }
      }
    }
    return item;
  }).filter((x): x is MessageItem => x !== null);
  const out: NexTagsPayload = {};
  if (messages) out.messages = messages;
  if (payload.actions) out.actions = payload.actions;
  return { payload: out, diagnostics };
}
```

- [ ] **Step 3: test + commit** → `feat: validacao zod-based com correcao (F2.3)`

**Phase F2 deliverable:** estrutura coagida e validada conforme schema. Limitações: texto ainda não normalizado; imagens e delays pendentes.

---

## Phase F3 — Normalização de texto

### Task F3.1: `normalize/text.ts`

**Files:** Create `src/normalize/text.ts`, `test/normalize/text.test.ts`

**Interfaces:**
- Consumes: `ResolvedOptions`.
- Produces: `normalizeText(s: string, opts: ResolvedOptions): { text: string; changed: boolean }`; `normalizePayloadText(payload, opts): { payload, diagnostics }`.

- [ ] **Step 1: Test**

```ts
// test/normalize/text.test.ts
import { expect, test } from 'vitest';
import { normalizeText } from '../../src/normalize/text';
import { resolveOptions } from '../../src/config/resolve';
const o = resolveOptions();
test('strips standard markdown but preserves WA-markup and emoji', () => {
  expect(normalizeText('**Oi** _ok_ 😉', o).text).toBe('Oi _ok_ 😉');           // ** removido, _ preservado
  expect(normalizeText('# Título', o).text).toBe('Título');
  expect(normalizeText('Veja [aqui](http://x)', o).text).toBe('Veja aqui');
  expect(normalizeText('- item', o).text).toBe('item');
});
test('preserves single-asterisk WA bold', () => { expect(normalizeText('*forte*', o).text).toBe('*forte*'); });
```

- [ ] **Step 2: Implementação** (ordem importa: `**` antes de `*`; remove só sintaxe-padrão)

```ts
// src/normalize/text.ts
import type { Diagnostic, NexTagsPayload, ResolvedOptions } from '../types';
import { Codes, diag } from '../errors';
export function normalizeText(input: string, opts: ResolvedOptions): { text: string; changed: boolean } {
  if (!opts.normalize.stripStandardMarkdown) return { text: input, changed: false };
  let s = input;
  s = s.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');     // links [txt](url) → txt
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1');               // **bold** → bold (antes do * único)
  s = s.replace(/```[\s\S]*?```/g, '').replace(/`([^`]+)`/g, '$1'); // code
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');              // # H1..H6
  s = s.replace(/^\s{0,3}>\s?/gm, '');                   // > blockquote
  s = s.replace(/^\s*[-*+]\s+/gm, '');                   // bullets (- * +) no início de linha
  s = s.replace(/[ \t]+\n/g, '\n').trim();
  return { text: s, changed: s !== input };
}
export function normalizePayloadText(payload: NexTagsPayload, opts: ResolvedOptions): { payload: NexTagsPayload; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const apply = (v: string | undefined): string | undefined => {
    if (typeof v !== 'string') return v; const r = normalizeText(v, opts);
    if (r.changed) diagnostics.push(diag(Codes.REPAIR_MARKDOWN_STRIPPED, 'Markdown-padrão removido')); return r.text;
  };
  for (const item of payload.messages ?? []) {
    if (typeof item === 'number') continue;
    const m = item.message; if (m.text !== undefined) m.text = apply(m.text);
    const p = m.attachment?.payload as any;
    if (p?.text !== undefined) p.text = apply(p.text);
    for (const el of p?.elements ?? []) { el.title = apply(el.title); el.subtitle = apply(el.subtitle); }
  }
  return { payload, diagnostics };
}
```

Nota: o bullet-regex `[-*+]` no início de linha pode colidir com `*forte*` só se `*forte*` estiver no começo da linha seguido de espaço; o teste cobre que `*forte*` (sem espaço após `*`) é preservado.

- [ ] **Step 3: test + commit** → `feat: normalizacao de texto preservando WA-markup (F3.1)`

**Phase F3 deliverable:** texto limpo de markdown-padrão, WA-markup intacto.

---

## Phase F4 — Imagens + proxy (Problema 3)

### Task F4.1: `images/detect.ts` — magic bytes

**Files:** Create `src/images/detect.ts`, `test/images/detect.test.ts`

**Interfaces:**
- Produces: `detectFormat(buf: Uint8Array): 'jpeg'|'png'|'webp'|'unknown'`; `isWebp(buf)`.

- [ ] **Step 1: Test**

```ts
// test/images/detect.test.ts
import { expect, test } from 'vitest';
import { detectFormat } from '../../src/images/detect';
test('detects jpeg/png/webp by magic bytes', () => {
  expect(detectFormat(new Uint8Array([0xff,0xd8,0xff,0xe0]))).toBe('jpeg');
  expect(detectFormat(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))).toBe('png');
  const webp = new Uint8Array(12); webp.set([0x52,0x49,0x46,0x46], 0); webp.set([0x57,0x45,0x42,0x50], 8);
  expect(detectFormat(webp)).toBe('webp');
});
```

- [ ] **Step 2: Implementação**

```ts
// src/images/detect.ts
export function isWebp(b: Uint8Array): boolean {
  return b.length >= 12 && b[0]===0x52 && b[1]===0x49 && b[2]===0x46 && b[3]===0x46 && b[8]===0x57 && b[9]===0x45 && b[10]===0x42 && b[11]===0x50;
}
export function detectFormat(b: Uint8Array): 'jpeg'|'png'|'webp'|'unknown' {
  if (b.length >= 3 && b[0]===0xff && b[1]===0xd8 && b[2]===0xff) return 'jpeg';
  if (b.length >= 8 && b[0]===0x89 && b[1]===0x50 && b[2]===0x4e && b[3]===0x47 && b[4]===0x0d && b[5]===0x0a && b[6]===0x1a && b[7]===0x0a) return 'png';
  if (isWebp(b)) return 'webp';
  return 'unknown';
}
```

- [ ] **Step 3: test + commit** → `feat: deteccao de formato por magic bytes (F4.1)`

---

### Task F4.2: `images/url.ts` + `images/proxy.ts` — normalização e reescrita

**Files:** Create `src/images/url.ts`, `src/images/proxy.ts`, `src/images/probe.ts`, `test/images/proxy.test.ts`

**Interfaces:**
- Consumes: `ResolvedOptions`.
- Produces: `normalizeUrl(url: string, opts): { url: string; changed: boolean }`; `proxyUrl(base: string, url: string): string`; `rewriteImages(payload, opts): { payload; diagnostics }`; `ImageProbe` (re-export).

- [ ] **Step 1: Test**

```ts
// test/images/proxy.test.ts
import { expect, test } from 'vitest';
import { normalizeUrl, proxyUrl, rewriteImages } from '../../src/images/proxy';
import { resolveOptions } from '../../src/config/resolve';
test('strips query string', () => {
  expect(normalizeUrl('https://x/a.webp.jpg?v=1', resolveOptions()).url).toBe('https://x/a.webp.jpg');
});
test('proxy rewrites image url', () => {
  const o = resolveOptions({ image: { proxyBase: 'https://p/cf-img-proxy' } });
  const r = rewriteImages({ messages: [{ message: { attachment: { type: 'image', payload: { url: 'https://x/a.jpg?v=1' } } } }] }, o);
  expect((r.payload.messages![0] as any).message.attachment.payload.url)
    .toBe('https://p/cf-img-proxy?u=' + encodeURIComponent('https://x/a.jpg'));
});
test('detect-only without proxy removes unverifiable webp image', () => {
  const o = resolveOptions({ image: { strategy: 'detect-only' } });
  const r = rewriteImages({ messages: [{ message: { attachment: { type: 'image', payload: { url: 'https://x/a.webp' } } } }] }, o);
  expect((r.payload.messages![0] as any).message.attachment).toBeUndefined();
  expect(r.diagnostics.some(d => d.code === 'PENDING_IMAGE_UNVERIFIABLE')).toBe(true);
});
```

- [ ] **Step 2: Implementação** (proxy-rewrite reescreve `payload.url` e `elements[].image_url`; detect-only aplica regra de ouro por extensão)

```ts
// src/images/url.ts
import type { ResolvedOptions } from '../types';
export function normalizeUrl(url: string, opts: ResolvedOptions): { url: string; changed: boolean } {
  if (!opts.image.stripQuery) return { url, changed: false };
  const stripped = url.split('?')[0] ?? url;
  return { url: stripped, changed: stripped !== url };
}
const BAD_EXT = /\.(webp|avif|svg|gif|bmp|tiff?|heic|heif)(\.|$)/i;
export function looksUnverifiable(url: string): boolean {
  const path = (url.split('?')[0] ?? url).toLowerCase();
  if (BAD_EXT.test(path)) return true;                       // .webp, .webp.jpg, etc.
  return !/\.(jpe?g|png)$/.test(path);                       // sem extensão clara JPEG/PNG
}
```
```ts
// src/images/proxy.ts
import type { Diagnostic, NexTagsPayload, ResolvedOptions } from '../types';
import { Codes, diag } from '../errors';
import { normalizeUrl, looksUnverifiable } from './url';
export { normalizeUrl };
export function proxyUrl(base: string, url: string): string { return `${base}?u=${encodeURIComponent(url)}`; }
export function rewriteImages(payload: NexTagsPayload, opts: ResolvedOptions): { payload: NexTagsPayload; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []; const img = opts.image;
  const handleUrl = (url: string): { url?: string; remove?: boolean } => {
    const n = normalizeUrl(url, opts); if (n.changed) diagnostics.push(diag(Codes.REPAIR_URL_NORMALIZED, 'URL normalizada'));
    if (img.strategy === 'proxy' && img.proxyBase) { diagnostics.push(diag(Codes.REPAIR_IMAGE_PROXIED, 'URL via proxy')); return { url: proxyUrl(img.proxyBase, n.url) }; }
    if (looksUnverifiable(n.url) && img.removeUnverifiable) { diagnostics.push(diag(Codes.PENDING_IMAGE_UNVERIFIABLE, `Imagem não-garantível: ${n.url}`)); return { remove: true }; }
    return { url: n.url };
  };
  for (const item of payload.messages ?? []) {
    if (typeof item === 'number') continue;
    const att = item.message?.attachment as any;
    if (att?.type === 'image' && att.payload?.url) {
      const r = handleUrl(att.payload.url);
      if (r.remove) delete item.message.attachment; else att.payload.url = r.url;
    }
    for (const el of att?.payload?.elements ?? []) {
      if (el.image_url) { const r = handleUrl(el.image_url); if (r.remove) delete el.image_url; else el.image_url = r.url; }
    }
  }
  return { payload, diagnostics };
}
```
```ts
// src/images/probe.ts
export type { ImageProbe } from '../types';
```

- [ ] **Step 3: test + commit** → `feat: normalizacao e reescrita de imagem via proxy (F4.2)`

---

### Task F4.3: `proxy/handler.ts` — proxy standalone com sharp

**Files:** Create `src/proxy/handler.ts`, `test/proxy/handler.test.ts`

**Interfaces:**
- Consumes: `detectFormat`, `isWebp`.
- Produces: `createProxyHandler(opts?: { fetchImpl?; transcode? }): (url: string) => Promise<{ body: Uint8Array; contentType: string }>`; injeta `fetchImpl` e `transcode` p/ testar sem rede/sharp.

- [ ] **Step 1: Test (com fetch e transcode mockados)**

```ts
// test/proxy/handler.test.ts
import { expect, test } from 'vitest';
import { createProxyHandler } from '../../src/proxy/handler';
const PNG = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const WEBP = (() => { const b = new Uint8Array(12); b.set([0x52,0x49,0x46,0x46],0); b.set([0x57,0x45,0x42,0x50],8); return b; })();
test('returns non-webp candidate without transcoding', async () => {
  const h = createProxyHandler({ fetchImpl: async (u) => u.includes('format=jpg') ? PNG : WEBP, transcode: async () => { throw new Error('should not transcode'); } });
  const r = await h('https://x/a.jpg'); expect(r.contentType).toBe('image/png');
});
test('transcodes when all candidates are webp', async () => {
  const JPEG = new Uint8Array([0xff,0xd8,0xff,0xe0]);
  const h = createProxyHandler({ fetchImpl: async () => WEBP, transcode: async () => JPEG });
  const r = await h('https://x/a.jpg'); expect(r.contentType).toBe('image/jpeg');
});
```

- [ ] **Step 2: Implementação** (camadas: Accept header via fetchImpl, query params, transcode)

```ts
// src/proxy/handler.ts
import { detectFormat, isWebp } from '../images/detect';
type FetchImpl = (url: string) => Promise<Uint8Array>;
type Transcode = (buf: Uint8Array) => Promise<Uint8Array>;
async function defaultFetch(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/jpeg,image/png' } });
  return new Uint8Array(await res.arrayBuffer());
}
async function defaultTranscode(buf: Uint8Array): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default; return new Uint8Array(await sharp(Buffer.from(buf)).jpeg().toBuffer());
}
export function createProxyHandler(opts: { fetchImpl?: FetchImpl; transcode?: Transcode } = {}) {
  const fetchImpl = opts.fetchImpl ?? defaultFetch; const transcode = opts.transcode ?? defaultTranscode;
  return async (rawUrl: string): Promise<{ body: Uint8Array; contentType: string }> => {
    const base = rawUrl.split('?')[0] ?? rawUrl;
    const candidates = [base + '?format=jpg', base + '?format=jpeg', base];
    let lastWebp: Uint8Array | null = null;
    for (const c of candidates) {
      try {
        const buf = await fetchImpl(c); if (buf.length < 4) continue;
        if (!isWebp(buf)) { const f = detectFormat(buf); return { body: buf, contentType: f === 'png' ? 'image/png' : 'image/jpeg' }; }
        lastWebp = buf;
      } catch { /* tenta próxima */ }
    }
    if (lastWebp) return { body: await transcode(lastWebp), contentType: 'image/jpeg' };
    return { body: new Uint8Array(0), contentType: 'image/jpeg' };
  };
}
```

- [ ] **Step 3: test + commit** → `feat: proxy handler com fallback de transcode sharp (F4.3)`

**Phase F4 deliverable:** imagens normalizadas e roteadas; proxy de referência cobre Shopify/Dooca. Limitações: blocos/delays pendentes.

---

## Phase F5 — Blocos + delays (Problema 2 + integridade)

### Task F5.1: `delays/classify.ts` — classificação de itens

**Files:** Create `src/delays/classify.ts`, `test/delays/classify.test.ts`

**Interfaces:**
- Produces: `classifyItem(item: MessageItem): ItemType`; `classifyItems(messages: MessageItem[]): ItemType[]`.

- [ ] **Step 1: Test**

```ts
// test/delays/classify.test.ts
import { expect, test } from 'vitest';
import { classifyItems } from '../../src/delays/classify';
test('classifies items', () => {
  expect(classifyItems([
    { message: { text: 'a' } }, 4,
    { message: { attachment: { type: 'image', payload: { url: 'u' } } } },
    { message: { attachment: { type: 'template', payload: { template_type: 'button', text: 't' } } } },
  ])).toEqual(['TEXT','DELAY','IMAGE','TEMPLATE']);
});
```

- [ ] **Step 2: Implementação**

```ts
// src/delays/classify.ts
import type { ItemType, MessageItem } from '../types';
export function classifyItem(item: MessageItem): ItemType {
  if (typeof item === 'number') return 'DELAY';
  const att = item.message?.attachment;
  if (att) { const t = att.type; return t === 'template' ? 'TEMPLATE' : (t.toUpperCase() as ItemType); }
  return 'TEXT';
}
export function classifyItems(messages: MessageItem[]): ItemType[] { return messages.map(classifyItem); }
```

- [ ] **Step 3: test + commit** → `feat: classificacao de itens (F5.1)`

---

### Task F5.2: `delays/blocks.ts` — detecção de produtos + ambiguidade

**Files:** Create `src/delays/blocks.ts`, `test/delays/blocks.test.ts`

**Interfaces:**
- Consumes: `classifyItem`.
- Produces: `detectProducts(messages: MessageItem[]): { productImageIdx: Set<number>; cardPairs: Array<[number, number]>; diagnostics: Diagnostic[] }` — índices (na sequência só-mensagens, sem delays) das imagens que iniciam um produto e dos pares imagem→template.

- [ ] **Step 1: Test**

```ts
// test/delays/blocks.test.ts
import { expect, test } from 'vitest';
import { detectProducts } from '../../src/delays/blocks';
const img = { message: { attachment: { type: 'image', payload: { url: 'u' } } } } as const;
const tmpl = { message: { attachment: { type: 'template', payload: { template_type: 'button', text: 't' } } } } as const;
const txt = { message: { text: 'a' } } as const;
test('detects two product cards', () => {
  const r = detectProducts([txt, img, tmpl, txt, txt, img, tmpl]);
  expect(r.cardPairs).toEqual([[1,2],[5,6]]); // índices sem delays
});
test('warns on orphan image', () => {
  const r = detectProducts([img, txt]);
  expect(r.diagnostics.some(d => d.code === 'WARN_BLOCK_AMBIGUOUS')).toBe(true);
});
```

- [ ] **Step 2: Implementação** (opera sobre a sequência só-mensagens; índices referem-se a essa sequência)

```ts
// src/delays/blocks.ts
import type { Diagnostic, MessageItem } from '../types';
import { Codes, diag } from '../errors';
import { classifyItem } from './classify';
export function detectProducts(messages: MessageItem[]): { cardPairs: Array<[number, number]>; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const onlyMsgs = messages.filter(m => typeof m !== 'number');
  const kinds = onlyMsgs.map(classifyItem);
  const cardPairs: Array<[number, number]> = [];
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === 'IMAGE') {
      if (kinds[i + 1] === 'TEMPLATE') { cardPairs.push([i, i + 1]); i++; }
      else diagnostics.push(diag(Codes.WARN_BLOCK_AMBIGUOUS, `Imagem órfã na posição ${i} (sem template em seguida)`));
    }
  }
  return { cardPairs, diagnostics };
}
```

- [ ] **Step 3: test + commit** → `feat: deteccao de produtos imagem-template (F5.2)`

---

### Task F5.3: `delays/insert.ts` — inserção idempotente de delays

**Files:** Create `src/delays/insert.ts`, `test/delays/insert.test.ts`

**Interfaces:**
- Consumes: `classifyItem`, `detectProducts`, `ResolvedOptions`.
- Produces: `insertDelays(messages: MessageItem[], opts: ResolvedOptions): { messages: MessageItem[]; diagnostics: Diagnostic[] }`.

- [ ] **Step 1: Test (golden do exemplo do usuário + dois produtos)**

```ts
// test/delays/insert.test.ts
import { expect, test } from 'vitest';
import { insertDelays } from '../../src/delays/insert';
import { resolveOptions } from '../../src/config/resolve';
const img = () => ({ message: { attachment: { type: 'image', payload: { url: 'u' } } } });
const tmpl = () => ({ message: { attachment: { type: 'template', payload: { template_type: 'button', text: 't' } } } });
const txt = () => ({ message: { text: 'a' } });
const kinds = (ms: any[]) => ms.map(m => typeof m === 'number' ? m : (m.message.attachment ? m.message.attachment.type : 'text'));
test('single product with surrounding text → 4/4/4', () => {
  const r = insertDelays([txt(), img(), tmpl(), txt()], resolveOptions());
  expect(kinds(r.messages)).toEqual(['text', 4, 'image', 4, 'template', 4, 'text']);
});
test('two products → interProduct 7 before second image', () => {
  const r = insertDelays([img(), tmpl(), img(), tmpl()], resolveOptions());
  expect(kinds(r.messages)).toEqual(['image', 4, 'template', 7, 'image', 4, 'template']);
});
test('idempotent: existing delays removed then reinserted', () => {
  const r = insertDelays([img(), 99, tmpl()], resolveOptions());
  expect(kinds(r.messages)).toEqual(['image', 4, 'template']);
});
```

- [ ] **Step 2: Implementação**

```ts
// src/delays/insert.ts
import type { Diagnostic, MessageItem, ResolvedOptions, TransitionType } from '../types';
import { Codes, diag } from '../errors';
import { classifyItem } from './classify';
import { detectProducts } from './blocks';
export function insertDelays(messages: MessageItem[], opts: ResolvedOptions): { messages: MessageItem[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const msgs = messages.filter(m => typeof m !== 'number');     // remove delays existentes (idempotente)
  const { cardPairs, diagnostics: blockDiag } = detectProducts(msgs);
  diagnostics.push(...blockDiag);
  const d = opts.delays;
  const clamp = (n: number) => Math.min(d.max, Math.max(d.min, n));
  const cardStart = new Set(cardPairs.map(([img]) => img));     // índice da imagem que abre cada card
  const intraGap = new Set(cardPairs.map(([img]) => img));      // gap após a imagem do card = intraCard
  const out: MessageItem[] = []; let seenCard = false;
  for (let i = 0; i < msgs.length; i++) {
    if (i > 0) {
      let kind: TransitionType;
      if (intraGap.has(i - 1)) kind = 'intraCard';              // imagem(i-1) → template(i)
      else if (cardStart.has(i) && seenCard) kind = 'interProduct'; // gap antes da imagem de um novo produto
      else kind = 'default';
      const base = kind === 'intraCard' ? d.intraCard : kind === 'interProduct' ? d.interProduct : d.bubble;
      out.push(clamp(d.perTransition[kind] ?? base));
    }
    if (cardStart.has(i)) seenCard = true;
    out.push(msgs[i]!);
  }
  if (msgs.length > 1) diagnostics.push(diag(Codes.REPAIR_DELAYS_INSERTED, 'Delays inseridos/normalizados'));
  return { messages: out, diagnostics };
}
```

- [ ] **Step 3: test + commit** → `feat: insercao idempotente de delays por transicao (F5.3)`

**Phase F5 deliverable:** delays inseridos preservando integridade; o golden do usuário passa. Limitações: simulação/relatório e pipeline ainda não conectados.

---

## Phase F6 — Simulação + estatísticas + pipeline

### Task F6.1: `simulate/stats.ts` + `simulate/timeline.ts`

**Files:** Create `src/simulate/stats.ts`, `src/simulate/timeline.ts`, `test/simulate/timeline.test.ts`

**Interfaces:**
- Consumes: `classifyItem`, `detectProducts`, `Report`.
- Produces: `computeStats(payload, report): Stats`; `buildSimulation(payload): Simulation`.

- [ ] **Step 1: Test**

```ts
// test/simulate/timeline.test.ts
import { expect, test } from 'vitest';
import { buildSimulation } from '../../src/simulate/timeline';
test('renders timeline with cumulative seconds', () => {
  const sim = buildSimulation({ messages: [
    { message: { attachment: { type: 'image', payload: { url: 'u' } } } }, 4,
    { message: { attachment: { type: 'template', payload: { template_type: 'button', text: 't' } } } },
  ] });
  expect(sim.stats.totalDurationSec).toBe(4);
  expect(sim.render()).toContain('00s 📷');
  expect(sim.render()).toContain('04s 🟨');
});
```

- [ ] **Step 2: Implementação**

```ts
// src/simulate/stats.ts
import type { MessageItem, NexTagsPayload, Report, Stats } from '../types';
import { classifyItem } from '../delays/classify';
import { detectProducts } from '../delays/blocks';
export function computeStats(payload: NexTagsPayload, report: Pick<Report,'repairs'|'warnings'|'errors'|'pending'>): Stats {
  const messages: MessageItem[] = payload.messages ?? [];
  let totalDurationSec = 0, imageCount = 0, messageCount = 0, delayCount = 0;
  for (const it of messages) {
    if (typeof it === 'number') { totalDurationSec += it; delayCount++; continue; }
    messageCount++; if (it.message?.attachment?.type === 'image') imageCount++;
  }
  const products = detectProducts(messages.filter(m => typeof m !== 'number')).cardPairs.length;
  return { totalDurationSec, productCount: products, imageCount, messageCount, delayCount,
    repairCount: report.repairs.length, warningCount: report.warnings.length,
    errorCount: report.errors.length, pendingCount: report.pending.length };
}
```
```ts
// src/simulate/timeline.ts
import type { MessageItem, NexTagsPayload, Simulation, TimelineEntry } from '../types';
import { classifyItem } from '../delays/classify';
import { computeStats } from './stats';
const ICON: Record<string,string> = { TEXT:'💬', IMAGE:'📷', VIDEO:'🎬', AUDIO:'🔊', FILE:'📎', TEMPLATE:'🟨' };
export function buildSimulation(payload: NexTagsPayload): Simulation {
  const messages: MessageItem[] = payload.messages ?? []; let at = 0; let product = 0;
  const timeline: TimelineEntry[] = [];
  for (const it of messages) {
    if (typeof it === 'number') { at += it; continue; }
    const kind = classifyItem(it); if (kind === 'IMAGE') product++;
    const label = kind === 'IMAGE' || kind === 'TEMPLATE' ? `Produto ${product || 1}` : (it.message.text ?? '').slice(0, 40);
    timeline.push({ atSec: at, icon: ICON[kind] ?? '•', kind, label });
  }
  const stats = computeStats(payload, { repairs: [], warnings: [], errors: [], pending: [] });
  return { timeline, stats, render() {
    return timeline.map(e => `${String(e.atSec).padStart(2,'0')}s ${e.icon} ${e.label}`).join('\n');
  } };
}
```

- [ ] **Step 3: test + commit** → `feat: simulacao e estatisticas (F6.1)`

---

### Task F6.2: `core/pipeline.ts` — orquestrador `process`

**Files:** Create `src/core/pipeline.ts`, `test/core/pipeline.test.ts`

**Interfaces:**
- Consumes: tudo de F1–F6.
- Produces: `process(raw: string, options?: MiddlewareOptions): Result`.

- [ ] **Step 1: Test (end-to-end, golden do usuário + fallback)**

```ts
// test/core/pipeline.test.ts
import { expect, test } from 'vitest';
import { process } from '../../src/core/pipeline';
const EXAMPLE = JSON.stringify({ messages: [
  { message: { text: 'Boa escolha! clique 👇' } },
  { message: { attachment: { type: 'image', payload: { url: 'https://cdn.shopify.com/.../Unitario_OSA_1024x.webp.jpg?v=1778503411' } } } },
  { message: { attachment: { type: 'template', payload: { template_type: 'button', text: 'Vitamina OSA', buttons: [{ type: 'web_url', title: 'Comprar', url: 'https://x?discount=ANALOVER10' }] } } } },
  { message: { text: 'Cupom já aplicado 😉' } },
]});
test('processes the real example: proxy + delays, no leak', () => {
  const r = process(EXAMPLE, { image: { proxyBase: 'https://p/cf-img-proxy' } });
  expect(r.ok).toBe(true);
  const ms = r.data!.messages!;
  expect(typeof ms[1]).toBe('number');                          // delay inserido após texto
  const imgUrl = (ms.find(m => typeof m !== 'number' && (m as any).message.attachment?.type==='image') as any).message.attachment.payload.url;
  expect(imgUrl.startsWith('https://p/cf-img-proxy?u=')).toBe(true);
  expect(imgUrl).not.toContain('?v=');                          // query removida antes do encode
});
test('irrecoverable → fallback message + handoff', () => {
  const r = process('lixo total ????', { fallback: { message: 'Já te respondo', handoff: { action: 'send_flow', flow_id: '123' } } });
  expect(r.ok).toBe(false);
  expect((r.data!.messages![0] as any).message.text).toBe('Já te respondo');
  expect(r.data!.actions![0]).toEqual({ action: 'send_flow', flow_id: '123' });
});
```

- [ ] **Step 2: Implementação**

```ts
// src/core/pipeline.ts
import type { MiddlewareOptions, NexTagsPayload, Result } from '../types';
import { resolveOptions } from '../config/resolve';
import { createReport } from '../report/report';
import { parseRecover } from '../parser/fallback';
import { coerceStructure } from '../normalize/structure';
import { validatePayload } from '../schema/validate';
import { normalizePayloadText } from '../normalize/text';
import { rewriteImages } from '../images/proxy';
import { insertDelays } from '../delays/insert';
import { buildSimulation } from '../simulate/timeline';
import { computeStats } from '../simulate/stats';
import { IrrecoverableError } from '../errors';
function fallbackPayload(opts: ReturnType<typeof resolveOptions>): NexTagsPayload {
  const p: NexTagsPayload = { messages: [{ message: { text: opts.fallback.message } }] };
  if (opts.fallback.handoff) p.actions = [opts.fallback.handoff as any];
  return p;
}
export function process(raw: string, options: MiddlewareOptions = {}): Result {
  const opts = resolveOptions(options); const report = createReport();
  try {
    const parsed = parseRecover(raw, opts); parsed.repairs.forEach(d => report.push(d));
    const coerced = coerceStructure(parsed.value); coerced.diagnostics.forEach(d => report.push(d));
    if (coerced.fatal) throw new IrrecoverableError('Raiz vazia', 'ERR_ROOT_EMPTY' as any);
    let payload = coerced.value;
    const v = validatePayload(payload); v.diagnostics.forEach(d => report.push(d)); payload = v.payload;
    const t = normalizePayloadText(payload, opts); t.diagnostics.forEach(d => report.push(d)); payload = t.payload;
    const im = rewriteImages(payload, opts); im.diagnostics.forEach(d => report.push(d)); payload = im.payload;
    if (payload.messages) { const dl = insertDelays(payload.messages, opts); dl.diagnostics.forEach(d => report.push(d)); payload.messages = dl.messages; }
    const stats = computeStats(payload, report);
    const result: Result = { ok: true, data: payload, report: report.finalize(stats) };
    if (opts.simulate) result.simulation = buildSimulation(payload);
    return result;
  } catch (e) {
    const err = e instanceof IrrecoverableError ? e : new IrrecoverableError(String(e), 'ERR_IRRECOVERABLE_JSON' as any);
    report.push({ code: err.code, message: err.message, fatal: true, detail: err.detail });
    const data = fallbackPayload(opts);
    const stats = computeStats(data, report);
    const result: Result = { ok: false, data, report: report.finalize(stats) };
    if (opts.simulate) result.simulation = buildSimulation(data);
    return result;
  }
}
```

- [ ] **Step 3: test + commit** → `feat: pipeline process end-to-end (F6.2)`

**Phase F6 deliverable:** `process()` funcional ponta-a-ponta; golden e fallback passam.

---

## Phase F7 — Card output, bundle, docs, CI

### Task F7.1: `card/output.ts` — guard-rail anti-vazamento + `index.ts`

**Files:** Create `src/card/output.ts`, `test/card/output.test.ts`; Modify `src/index.ts`

**Interfaces:**
- Consumes: `Result`.
- Produces: `toCardOutput(result, opts?): Record<string, unknown>`; `src/index.ts` re-exporta `process`, `toCardOutput`, `createProxyHandler`, tipos.

- [ ] **Step 1: Test**

```ts
// test/card/output.test.ts
import { expect, test } from 'vitest';
import { process } from '../../src/core/pipeline';
import { toCardOutput } from '../../src/card/output';
test('client field carries only data; report goes to debug', () => {
  const r = process('{"messages":[{"message":{"text":"oi"}}]}');
  const out = toCardOutput(r, { clientField: 'resposta', debugField: '_debug' });
  expect(typeof out.resposta).toBe('string');
  expect(JSON.parse(out.resposta as string).messages[0].message.text).toBe('oi');
  expect(out.resposta).not.toContain('repairs');           // nenhum diagnóstico no campo do cliente
  expect((out._debug as any).stats).toBeDefined();
});
```

- [ ] **Step 2: Implementação**

```ts
// src/card/output.ts
import type { Result } from '../types';
export function toCardOutput(result: Result, opts: { clientField?: string; debugField?: string; stringify?: boolean } = {}): Record<string, unknown> {
  const clientField = opts.clientField ?? 'resposta';
  const debugField = opts.debugField ?? '_debug';
  const stringify = opts.stringify ?? true;
  const data = result.data ?? {};
  return {
    [clientField]: stringify ? JSON.stringify(data) : data,
    [debugField]: { ok: result.ok, report: result.report, ...(result.simulation ? { simulation: result.simulation.timeline } : {}) },
  };
}
```
```ts
// src/index.ts
export { process } from './core/pipeline';
export { toCardOutput } from './card/output';
export { buildSimulation } from './simulate/timeline';
export type * from './types';
export const VERSION = '0.1.0';
```

- [ ] **Step 3: test + commit** → `feat: toCardOutput anti-vazamento + index publico (F7.1)`

---

### Task F7.2: Build do bundle de card + verificação

**Files:** Modify `package.json` (já tem build); Create `test/bundle.test.ts` (smoke do IIFE)

- [ ] **Step 1: Rodar build**

Run: `npm run build`
Expected: gera `dist/index.{mjs,cjs}`, `dist/proxy.{mjs,cjs}`, `dist/card.global.js`, sem erros.

- [ ] **Step 2: Smoke do bundle IIFE** (carrega o global e processa)

```ts
// test/bundle.test.ts
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
test('card bundle exposes WAMW.process and processes input', () => {
  const code = readFileSync('dist/card.global.js', 'utf8');
  const sandbox: any = {};
  new Function('globalThis', code + '\nglobalThis.__WAMW = WAMW;').call(sandbox, sandbox);
  const out = sandbox.__WAMW.toCardOutput(sandbox.__WAMW.process('{"messages":[{"message":{"text":"oi"}}]}'));
  expect(JSON.parse(out.resposta).messages[0].message.text).toBe('oi');
});
```

Nota: se `platform:'neutral'` não expor `WAMW` como esperado em `new Function`, ajustar `tsup` para `globalName` acessível via `globalThis.WAMW` (documentar no README a forma de uso no Code node).

- [ ] **Step 3: test + commit** → `chore: build de bundle de card + smoke (F7.2)`

---

### Task F7.3: Corpus de fixtures + property-based no parser

**Files:** Create `test/fixtures/broken/*.txt`, `test/parser/property.test.ts`

- [ ] **Step 1: Criar fixtures** (um arquivo por caso: `fence.txt`, `truncated.txt`, `trailing-comma.txt`, `smart-quotes.txt`, `type-in-payload.txt`, `partial.txt`)

- [ ] **Step 2: Property test (fast-check)**

```ts
// test/parser/property.test.ts
import { expect, test } from 'vitest';
import fc from 'fast-check';
import { process } from '../../src/core/pipeline';
test('never throws and never leaks report into client field', () => {
  fc.assert(fc.property(fc.string(), (s) => {
    const r = process(s);
    expect(typeof r.ok).toBe('boolean');                 // sempre retorna Result, nunca lança
    expect(r.data).toBeDefined();                        // sempre há data (payload ou fallback)
  }));
});
```

- [ ] **Step 3: test + commit** → `test: corpus de fixtures + property-based no parser (F7.3)`

---

### Task F7.4: README, exemplo de Code node, CI

**Files:** Create `README.md`, `examples/n8n-code-node.js`, `.github/workflows/ci.yml`

- [ ] **Step 1: README** — instalação, API (`process`, `toCardOutput`, `createProxyHandler`), tabela de `MiddlewareOptions`, padrão do Code node, deploy do proxy, contrato anti-vazamento, lista de `Codes`.

- [ ] **Step 2: `examples/n8n-code-node.js`** — bloco comentado: colar `dist/card.global.js` + `const r = WAMW.process($json.iaOutput, {...}); return [{ json: WAMW.toCardOutput(r, { clientField: '<seu_campo>' }) }];`

- [ ] **Step 3: `.github/workflows/ci.yml`** — Node 20, `npm ci`, `typecheck`, `lint`, `test`, `build`.

- [ ] **Step 4: commit** → `docs: readme, exemplo de code node e CI (F7.4)`

**Phase F7 deliverable:** biblioteca completa, empacotada (npm + bundle de card), documentada, com CI. Pronta para produção.

---

## Self-Review

**1. Spec coverage:**
- Reparo JSON (Problema 1) → F1.1–F1.5. ✓
- Validação/schema → F2.1–F2.3. ✓
- Normalização texto → F3.1. ✓
- Imagens WEBP/proxy (Problema 3) → F4.1–F4.3. ✓
- Delays/blocos/integridade (Problema 2) → F5.1–F5.3. ✓
- Simulação/estatísticas → F6.1. ✓
- Falha→fallback+handoff → F6.2. ✓
- Anti-vazamento/card/bundle → F7.1–F7.2. ✓
- Logging estruturado → F0.4 (report) usado em todo o pipeline. ✓
- Testes automatizados → cada task + F7.3. ✓
- Modular/evoluível → estrutura de arquivos por responsabilidade. ✓
- Nota de segurança (token) → spec §19 (não é código). ✓

**2. Placeholder scan:** Sem TBD/TODO em passos de código; F7.2/F7.4 têm passos descritivos (build/README/CI) apropriados a tarefas não-código.

**3. Type consistency:** Nomes verificados de ponta a ponta — `process`, `toCardOutput`, `resolveOptions`, `parseRecover`, `coerceStructure`, `validatePayload`, `normalizePayloadText`, `rewriteImages`, `insertDelays`, `detectProducts`, `classifyItem`, `buildSimulation`, `computeStats`, `createReport`, `Codes`, `diag`. Tipos centrais em `types.ts`. `detectProducts` retorna `{ cardPairs, diagnostics }` e é consumido assim em F5.3/F6.1.

**Riscos conhecidos a validar na execução:**
- Smoke do bundle IIFE (F7.2) pode exigir ajuste de `globalName`/`platform` no tsup; passo já prevê o ajuste.
- O regex de bullet em `normalize/text` (`[-*+]` início de linha) precisa não comer WA-bold `*x*`; teste F3.1 cobre o caso sem espaço após `*`.
- `exactOptionalPropertyTypes` pode exigir cuidado ao montar objetos opcionais (`out.messages` só quando definido) — já refletido no código.
