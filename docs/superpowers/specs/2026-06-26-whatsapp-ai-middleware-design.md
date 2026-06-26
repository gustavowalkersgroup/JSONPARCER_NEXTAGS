# whatsapp-ai-middleware — Documento de Design

- **Data:** 2026-06-26
- **Status:** Aprovado para planejamento de implementação
- **Autor:** Gustavo (NexTags) + Claude
- **Tipo:** Biblioteca TypeScript/JavaScript (middleware de runtime)

---

## 1. Objetivo

Biblioteca que atua como middleware entre a saída de um modelo de IA
(Claude) e o middleware de canais da **plataforma NexTags Messenger**
(WhatsApp, Instagram, Messenger). Recebe a resposta crua produzida pela IA
— potencialmente imperfeita — e devolve um JSON **seguro, válido,
normalizado e sincronizado**, pronto para envio, mais um relatório de
diagnóstico **separado**.

A biblioteca é a versão **em runtime, programática e robusta** do que a
skill `nextags-json-fixer` faz hoje em modo assistido, acrescida de:
reparo de JSON malformado por parser próprio, inserção inteligente de
delays entre blocos, correção de formato de imagem via proxy, normalização
de URLs, modo de simulação e logging estruturado.

### 1.1. Schema-alvo

O contrato de saída é o **schema oficial da NexTags Messenger Messaging
Platform** (referência canônica: skill `nextags-json-fixer`,
`references/schema.md`). Resumo operativo:

- Raiz: objeto com `messages` e/ou `actions` (pelo menos uma).
- `messages[]`: cada item é **um objeto** `{"message": {...}}` **ou** um
  **inteiro** 1–30 (typing indicator / delay em segundos).
- Payloads de mensagem: `text`; `attachment` (`type` ∈
  `image|video|audio|file` com `payload.url`, **`type` FORA de
  `payload`**); `attachment` `template` (`generic` carrossel ≥2 elementos,
  ou `button` com `text` + botões `web_url`→`url` / `postback`→`payload`).
- `actions[]`: 8 ações canônicas (`add_tag`, `remove_tag`,
  `set_field_value`, `unset_field_value`, `send_flow`,
  `transfer_conversation_to`, `assign_conversation`,
  `unassign_conversation`).
- Imagens: só JPEG/PNG nos canais; WebP/AVIF/SVG/GIF quebram entrega.
- Texto: sem markdown-padrão (`**`, `#`, `>`, ` ``` `, `- bullet`,
  `[txt](url)`) que vaza literal; **WA-markup `*x*` `_x_` `~x~` e emojis
  são preservados**; aspas retas.

---

## 2. Restrições de runtime (definem a arquitetura)

Estas restrições do usuário são as forças dominantes do design:

1. **Execução em JavaScript dentro de um "card"** (n8n Code node ou
   equivalente). Não há `npm install` no ponto de execução — o artefato
   primário precisa ser **um único arquivo JS autossuficiente**, com todas
   as dependências **embutidas (inlinadas)** no bundle.
2. **Nada pode vazar para o cliente além da resposta validada e correta.**
   A saída do cliente recebe **exclusivamente** o payload validado (ou um
   fallback seguro). Relatório, warnings, reparos e erros vão para um campo
   **interno separado** ou console — **nunca** concatenados na mensagem do
   cliente.
3. **Falha nunca produz lixo ao cliente.** JSON irrecuperável resulta numa
   mensagem de fallback segura + handoff, nunca conteúdo quebrado.

### 2.1. Decisões consolidadas (brainstorming)

| # | Decisão | Escolha |
|---|---------|---------|
| 1 | Reparo de JSON | **Híbrido**: parser tolerante próprio + fallback `jsonrepair` |
| 2 | Delays | **Configurável**: 4s intra-card / 7s inter-produto, defaults sensatos |
| 3 | Linguagem/build | **TS strict**, build dual ESM+CJS **+ bundle de card** |
| 4 | Imagem | **Proxy genérico** (negociação + transcode `sharp`) |
| 5 | Empacotamento card | **Bundle único com zod/jsonrepair embutidos** |
| 6 | Falha irrecuperável | **Mensagem fallback + handoff** |
| 7 | Bloco com texto | **Defaults + config por transição**; par imagem→template protegido |
| 8 | Validação | **zod** (deriva tipos), embutido no bundle |

---

## 3. Modelo conceitual

Um **pipeline puro de transformação**. Núcleo síncrono, determinístico,
sem rede. Qualquer I/O (probe de Content-Type) é uma capacidade
**injetável e opcional** — a lib funciona offline por padrão, o que a torna
testável sem mocks de rede.

```
process(rawModelOutput: string, options?: MiddlewareOptions): Result
```

### 3.1. Contrato de retorno

```ts
interface Result {
  ok: boolean;            // false = não foi possível recuperar com segurança
  data?: NexTagsPayload;  // JSON normalizado pronto pro MCP (ou fallback se !ok)
  report: Report;         // diagnóstico — NUNCA vai pro cliente
  simulation?: Simulation;// presente se options.simulate === true
}

interface Report {
  repairs:  Repair[];   // o que foi consertado e por quê
  warnings: Warning[];  // suspeitas: ambiguidade de bloco, >1 web_url, CTA>20
  errors:   ProcessError[]; // por que falhou (se !ok)
  pending:  Pending[];  // requer ação humana: imagem não-garantível, admin_id sujo
  stats:    Stats;
}

interface Stats {
  totalDurationSec: number; // soma dos delays na timeline
  productCount: number;     // pares imagem→template detectados
  imageCount: number;
  messageCount: number;     // objetos de mensagem (exclui delays)
  delayCount: number;
  repairCount: number;
  warningCount: number;
  errorCount: number;
  pendingCount: number;
}
```

`Repair`, `Warning`, `ProcessError`, `Pending` compartilham forma base:
`{ code: string, message: string, path?: string, detail?: unknown }`.
`code` é um enum estável (ex.: `REPAIR_TYPE_MOVED_OUT_OF_PAYLOAD`,
`WARN_BLOCK_AMBIGUOUS`, `PENDING_IMAGE_UNVERIFIABLE`,
`ERR_IRRECOVERABLE_JSON`) para consumo programático.

### 3.2. Contrato de saída do card (guard-rail anti-vazamento)

```ts
function toCardOutput(
  result: Result,
  opts?: { clientField?: string; debugField?: string; stringify?: boolean }
): Record<string, unknown>;
// default: { clientField: 'resposta', debugField: '_debug', stringify: true }
```

- `clientField` recebe **apenas** `JSON.stringify(result.data)`.
- `debugField` recebe `result.report` (e `simulation`).
- É **estruturalmente impossível** o `report` cair no campo do cliente.

Uso no Code node (única lógica além do bundle colado):
```js
const result = WAMW.process($json.iaOutput, { /* config */ });
const out = WAMW.toCardOutput(result, { clientField: 'resposta', debugField: '_debug' });
return [{ json: out }];
```

---

## 4. Pipeline — estágios

Ordem fixa. Cada estágio recebe e devolve um contexto acumulando o
`report`.

| # | Estágio | Responsabilidade | Falha |
|---|---------|------------------|-------|
| 1 | **Extract** | Desencapsular: remove fence ` ```json `, prosa antes/depois; isola o `{…}` externo por balanceamento de chaves respeitando strings | recuperável |
| 2 | **Parse + Repair** | Tokenizer + parser tolerante → AST; reparo estrutural; fallback `jsonrepair` | **fatal** se irrecuperável |
| 3 | **Coerce estrutural** | Garante raiz `messages`/`actions`; move `attachment.type` p/ fora do `payload`; canoniza aliases de ações; aspas curvas→retas | recuperável |
| 4 | **Validate** | Valida contra schema zod NexTags; classifica em erro/warning/pendência | classifica |
| 5 | **Normalize texto** | Remove markdown-padrão que vaza; preserva WA-markup e emojis; typing indicator inteiro 1–30 | recuperável |
| 6 | **Image pipeline** | Normaliza URL (strip query); reescreve via proxy; detecta formato; probe opcional; regra de ouro | recuperável |
| 7 | **Blocks + Delays** | Detecta cards imagem→template por posição; insere delays; nunca reassocia | recuperável |
| 8 | **Simulate** (opt) | Timeline + estatísticas | — |
| 9 | **Report** | Consolida log estruturado | — |

Em qualquer falha **fatal** (estágio 2), o pipeline curto-circuita para a
rotina de fallback (§9) e ainda devolve `Result` com `ok:false`.

---

## 5. Módulos

```
src/
  index.ts                 // API pública: process, simulate, toCardOutput, createProxyHandler
  core/pipeline.ts         // orquestrador dos estágios
  config/
    defaults.ts            // defaults
    resolve.ts             // merge + validação de MiddlewareOptions
  errors.ts                // erros tipados + códigos estáveis

  parser/
    extract.ts             // desencapsula fence/prosa, isola {…}
    tokenizer.ts           // tokenizer tolerante
    parser.ts              // recursive-descent com recuperação → AST
    repair.ts              // reparos estruturais pré/pós-parse
    fallback.ts            // adapter jsonrepair (caminho extremo)

  schema/
    types.ts               // tipos TS (derivados do zod via z.infer)
    schema.ts              // zod schema do payload NexTags
    actions.ts             // tabela de ações + aliases canônicos

  normalize/
    text.ts                // markdown-leak, aspas, WA-markup preservado
    structure.ts           // type fora do payload, shape raiz, coerções

  images/
    url.ts                 // normalização de URL (strip query)
    detect.ts              // magic bytes: WEBP/JPEG/PNG
    proxy.ts               // reescrita p/ proxy + createProxyHandler()
    probe.ts               // interface ImageProbe injetável (opcional)

  delays/
    blocks.ts              // detector de blocos posicional
    insert.ts              // inserção/normalização idempotente de delays

  simulate/
    timeline.ts            // linha do tempo + ícones
    stats.ts               // estatísticas

  report/
    logger.ts              // log estruturado + níveis

  card/
    output.ts              // toCardOutput (guard-rail)

  proxy/
    handler.ts             // proxy de imagem standalone (Node + sharp)
```

Cada módulo: uma responsabilidade, interface explícita, testável isolado.

---

## 6. Parser híbrido (Problema 1)

### 6.1. `extract.ts`
- Remove cercas markdown (` ```json … ``` `, ` ``` … ``` `).
- Remove prosa antes do primeiro `{` e depois do `}` correspondente.
- Localiza o objeto externo por **balanceamento de chaves**, ignorando
  chaves dentro de strings (respeita aspas e escapes).

### 6.2. `tokenizer.ts`
Tokens: `{ } [ ] : ,`, string, number, `true|false|null`. Tolerâncias:
- Aspas curvas `“ ” ‘ ’` → tratadas como aspas retas.
- Aspas simples em strings → aceitas.
- Vírgulas finais (trailing commas) → toleradas.
- Chaves não-quotadas → aceitas (modo tolerante).

### 6.3. `parser.ts` — recursive-descent com recuperação
Produz uma AST. Estratégias de recuperação, cada uma registra um `Repair`:
- **Truncamento / EOF inesperado:** fecha automaticamente estruturas
  abertas (`}`/`]` pendentes).
- **Vírgula faltando** entre elementos → insere.
- **Colchete/chave faltando** → fecha no ponto provável.
- **Objeto parcialmente incompleto** → mantém o que é válido, descarta o
  fragmento final irrecuperável (registra Repair com `path`).

### 6.4. `repair.ts`
Correções mais fáceis como texto, aplicadas antes do parse: normalização de
aspas, remoção de fence residual, balanceamento óbvio.

### 6.5. `fallback.ts`
Se o parser próprio lançar irrecuperável, tenta `jsonrepair` →
`JSON.parse`. Se também falhar → `ERR_IRRECOVERABLE_JSON` (estágio fatal).
`options.parser.useFallbackLibrary` (default `true`) permite desligar.

---

## 7. Schema e validação (zod)

`schema/schema.ts` define o schema zod completo; `types.ts` deriva via
`z.infer`. Regras validadas e a classificação de cada violação:

| Regra | Violação → |
|-------|-----------|
| Raiz tem `messages` e/ou `actions` | ausência de ambas → **erro fatal** |
| `attachment.type` ∈ `image,video,audio,file,template` | outro → erro (remove attachment) |
| `attachment.type` fora de `payload` | dentro → **repair** (move pra fora) |
| Carrossel `generic` ≥ 2 elementos | <2 → erro (remove ou rebaixa) |
| Botão `web_url` tem `url` | falta → erro (remove botão) |
| Botão `postback` tem `payload` | falta → erro (remove botão) |
| Button template tem `text` | falta → **pendência** |
| ≤1 botão `web_url` por mensagem | >1 → **warning** (mantém o 1º) |
| CTA (`title`) ≤ 20 chars | >20 → **warning** (não trunca) |
| Typing indicator inteiro 1–30 | fora → **repair** (clamp/coerção) |
| Ação canônica (aliases) | alias → **repair** (`addTag`→`add_tag`) |
| `admin_id` limpo | sujo (`"Estela."`) → **pendência** |
| Sintaxe legada `Rotativo()`, `{{...}}` em action | → **pendência** (remove da `actions`) |

**Não corrigir** (convenções de produção): placeholders dinâmicos
(`{nome}`, `<CHECKOUT_URL>`), `flow_id` de 13 dígitos, ordem de ações.

---

## 8. Normalização de texto (estágio 5)

`normalize/text.ts`, aplicado a `text`/`title`/`subtitle`:
- **Remove markdown-padrão que vaza literal:** `**bold**` (asterisco
  duplo), `# H1`, `> blockquote`, ` `code` `/cercas, bullets `- item`,
  links `[txt](url)` (preserva o texto, remove a sintaxe).
- **Preserva WA-markup:** `*negrito*` (asterisco único), `_itálico_`,
  `~tachado~`, e emojis. Estes renderizam na plataforma.
- Aspas curvas → retas (também no estágio de coerção).

---

## 9. Falha irrecuperável → fallback seguro (decisão 6)

Quando `ok:false`, `data` recebe um payload de fallback **válido**:

```ts
fallback?: {
  message?: string;  // default: "Só um instante que já te respondo 😊"
  handoff?:
    | { action: 'send_flow'; flow_id: string }
    | { action: 'transfer_conversation_to'; value: 'human' }
    | null;          // null = sem handoff automático
}
```

Resultado:
```json
{
  "messages": [{ "message": { "text": "<fallback.message>" } }],
  "actions":  [ <fallback.handoff> ]   // omitido se handoff === null
}
```

O cliente vê uma mensagem segura; o atendimento continua via handoff; o
erro real fica **só** no `report.errors` (campo `_debug`).

---

## 10. Pipeline de imagem (Problema 3 + decisão 4)

### 10.1. Core (roda no card, puro, sem I/O)
- `url.ts`: normaliza removendo query string (`...webp.jpg?v=123` →
  `...webp.jpg`). Configurável (`image.stripQuery`, default `true`).
- `proxy.ts`: quando `image.strategy === 'proxy'`, reescreve `payload.url`
  e `elements[].image_url` para
  `${image.proxyBase}?u=${encodeURIComponent(urlNormalizada)}`.
- Sem `proxyBase` configurado → **regra de ouro**: se não dá pra garantir
  JPEG/PNG, remove a imagem + `PENDING_IMAGE_UNVERIFIABLE`
  (`image.removeUnverifiable`, default `true`).
- **Nunca confia na extensão** — o exemplo real tem `.webp.jpg`.

### 10.2. Proxy de referência (serviço Node separado, com `sharp`)
`createProxyHandler()` em `src/proxy/handler.ts`, exportado como
`whatsapp-ai-middleware/proxy`. Handler Express/Fetch. Estratégia em
camadas para `?u=<url>`:
1. **Header `Accept: image/jpeg,image/png`** — resolve CDNs que servem
   WebP por content-negotiation (ex.: Shopify).
2. **Query `?format=jpg` / `?format=jpeg`** — resolve Dooca.
3. **URL crua.**
4. Para cada candidata: baixa bytes, detecta WebP por **magic bytes**
   (RIFF: offset 0–4 = `RIFF`, offset 8–12 = `WEBP`). Aceita a primeira
   **não-WebP**, confirmando JPEG (`FF D8 FF`) ou PNG
   (`89 50 4E 47 0D 0A 1A 0A`).
5. Se todas vierem WebP → **transcodifica com `sharp`** para JPEG.
6. Responde binário com `Content-Type` correto.

`detect.ts` encapsula os magic bytes (compartilhado entre core e proxy).
`sharp` é dependência **apenas** do entry `/proxy`, nunca do bundle de
card.

### 10.3. Probe opcional (`probe.ts`)
Interface injetável `ImageProbe = (url: string) => Promise<{ contentType: string }>`.
Se fornecida (`image.probe`), o core pode confirmar Content-Type real
antes de decidir. Sem probe = decisão offline por URL/estrutura. Nos
testes, sempre mockada.

---

## 11. Blocos e delays (Problema 2 + integridade — decisão 7)

### 11.1. Classificação
Cada item de `messages` é classificado:
`TEXT | IMAGE | VIDEO | AUDIO | FILE | TEMPLATE | DELAY(int)`.

### 11.2. Detecção de card de produto (posicional, sem adivinhação)
- **Card de produto** = uma `IMAGE` diretamente seguida (ignorando delays
  existentes) de um `TEMPLATE`. Esse par é **protegido**: nunca reordenado,
  nunca reassociado.
- Um `TEMPLATE` sem imagem anterior é um button template válido isolado
  (sem warning).
- **Ambiguidade** → `WARN_BLOCK_AMBIGUOUS`, preserva ordem, não adivinha:
  - `IMAGE` órfã (sem `TEMPLATE` em seguida).
  - Duas `IMAGE` consecutivas.

### 11.3. Inserção de delays (idempotente)
1. Remove **todos** os delays inteiros existentes (normaliza).
2. Caminha a sequência de mensagens e insere por **tipo de transição**:

| Transição | Default | Chave de config |
|-----------|---------|-----------------|
| `IMAGE → TEMPLATE` (mesmo card) | **4** | `delays.intraCard` |
| gap **antes da imagem de um novo produto** (exceto o 1º) | **7** | `delays.interProduct` |
| qualquer outra (texto↔mídia, texto↔texto, template→texto) | **4** | `delays.bubble` |

3. Overrides finos opcionais via `delays.perTransition`.
4. Todos os valores sofrem clamp em `[delays.min=1, delays.max=30]`.

### 11.4. Exemplo (golden fixture)
Entrada (1 produto, com texto em volta — exemplo real do usuário):
```
TEXT(intro) · IMAGE(...Unitario_OSA_1024x.webp.jpg?v=...) · TEMPLATE(button) · TEXT(cupom)
```
Saída esperada:
```
TEXT(intro) · 4 · IMAGE(<proxy>?u=...Unitario_OSA_1024x.webp.jpg) · 4 · TEMPLATE(button) · 4 · TEXT(cupom)
```
- Sem `interProduct` (produto único).
- Imagem reescrita via proxy, query removida.
- Nenhum reparo de JSON (entrada já bem-formada).

---

## 12. Modo simulação (decisão: parte do escopo)

`options.simulate === true` → `result.simulation`:
```ts
interface Simulation {
  timeline: { atSec: number; icon: string; kind: string; label: string }[];
  render(): string;   // "00s 📷 Produto 1\n04s 🟨 Produto 1\n11s 📷 Produto 2..."
  stats: Stats;       // tempo total, nº produtos, imagens, delays, warnings, erros, reparos
}
```
Ícones: 📷 imagem · 🟨 template · 💬 texto · 🎬 vídeo · 🔊 áudio · 📎 arquivo.

---

## 13. Configuração completa

```ts
interface MiddlewareOptions {
  image?: {
    strategy?: 'proxy' | 'detect-only';   // default 'proxy'
    proxyBase?: string;                     // ex.: 'https://nextags.app.br/webhook/cf-img-proxy'
    stripQuery?: boolean;                   // default true
    removeUnverifiable?: boolean;           // default true
    probe?: ImageProbe;                     // opcional
  };
  delays?: {
    intraCard?: number;     // default 4
    interProduct?: number;  // default 7
    bubble?: number;        // default 4
    min?: number;           // default 1
    max?: number;           // default 30
    perTransition?: Partial<Record<TransitionType, number>>;
  };
  fallback?: {
    message?: string;       // default "Só um instante que já te respondo 😊"
    handoff?: { action: 'send_flow'; flow_id: string }
            | { action: 'transfer_conversation_to'; value: 'human' }
            | null;         // default null
  };
  normalize?: {
    stripStandardMarkdown?: boolean;  // default true
    preserveWhatsappMarkup?: boolean; // default true
    straightenQuotes?: boolean;       // default true
  };
  parser?: {
    useFallbackLibrary?: boolean;     // default true
    maxRepairPasses?: number;         // default 3
  };
  simulate?: boolean;                 // default false
  report?: { level?: 'silent'|'error'|'warn'|'info'|'debug' }; // default 'warn'
}
```

---

## 14. Tratamento de erro — classificação

| Categoria | Significado | Efeito |
|-----------|-------------|--------|
| **Repair** | Corrigido automaticamente com segurança | Registra, continua |
| **Warning** | Suspeita, não bloqueia | Registra, mantém comportamento seguro |
| **Pending** | Requer ação humana | Registra; pode remover o item afetado |
| **Error (não-fatal)** | Item inválido removido/rebaixado | Registra, continua com o resto |
| **Error (fatal)** | JSON irrecuperável / raiz vazia | `ok:false` + fallback (§9) |

Princípio: **falha explícita > saída silenciosamente errada**. A lib nunca
adivinha associação produto↔imagem para forçar sucesso.

---

## 15. Testes

- **Vitest.**
- **Unit por módulo.**
- **Corpus de JSON quebrado** (`test/fixtures/broken/`): truncado, fence
  markdown, vírgula sobrando, `type` dentro do `payload`, aspas curvas,
  objeto parcial, colchete faltando.
- **Property-based** (`fast-check`) no parser: gerar JSON válido, corromper
  de formas conhecidas, exigir recuperação ou falha limpa.
- **Golden tests** end-to-end do pipeline, incluindo o exemplo real do
  usuário (§11.4) com saída esperada fixada.
- **Anti-vazamento:** teste afirmando que `toCardOutput(...).<clientField>`
  nunca contém chaves de `report`.
- **Probe sempre mockado** (zero rede nos testes). Proxy testado com
  `sharp` sobre fixtures binárias locais.

---

## 16. Build e empacotamento (decisões 3 + 5)

- **TS strict**, `esbuild`/`tsup`.
- Alvos:
  - `dist/index.{mjs,cjs}` + `dist/index.d.ts` — pacote npm dual ESM/CJS.
  - `dist/card.global.js` — **bundle IIFE autossuficiente**
    (`bundle:true, minify:true, format:'iife', globalName:'WAMW',
    platform:'neutral'`), com **zod e jsonrepair inlinados**, zero
    `require` externo. É o arquivo colado no Code node; expõe
    `WAMW.process`, `WAMW.toCardOutput`, etc.
  - `dist/proxy.{mjs,cjs}` — entry `/proxy` (depende de `sharp`,
    **excluído** do bundle de card).
- `package.json` `exports` mapeando `.`, `./proxy`.
- Lint/format: ESLint + Prettier. CI: typecheck + test + build.

---

## 17. Fases de implementação

Cada fase termina com **todos os testes verdes** e entrega: funcionalidades,
testes criados, limitações atuais, próximos passos.

- **F0** — scaffold (TS, vitest, esbuild, eslint), `schema/` (zod) +
  `types`, `config/`, `errors`.
- **F1** — `parser/` híbrido completo (extract, tokenizer, parser
  tolerante, repair, fallback) + corpus de fixtures. *(Problema 1)*
- **F2** — `schema/` validate + `normalize/structure` (coerce, type
  fora do payload, aliases de ação).
- **F3** — `normalize/text` (markdown-leak, WA-markup, aspas).
- **F4** — `images/` (url, detect, proxy-rewrite) + `proxy/handler`
  (`sharp`) + probe opcional. *(Problema 3)*
- **F5** — `delays/` (blocks + insert idempotente). *(Problema 2 +
  integridade)*
- **F6** — `simulate/` + `report/` + `stats`.
- **F7** — `card/output` (`toCardOutput`), bundle de card, docs, exemplos,
  CI, README.

---

## 18. Limitações conhecidas / fora de escopo

- `video`/`audio`/`file` têm **zero precedente** nos prompts reais — schema
  os aceita, mas não geramos casos inventados; o delay os trata como mídia
  genérica.
- Carrossel `generic` é raro em produção (padrão real = botão único
  `web_url`); validado, mas não otimizado.
- O proxy de imagem requer **deploy separado** (serviço Node com `sharp`);
  o card só reescreve a URL.
- Probe de rede é **opcional**; por padrão a decisão de formato é offline
  (extensão/estrutura) + proxy.
- A lib **não** reassocia imagem↔template nem reordena mensagens — apenas
  insere delays e normaliza.

---

## 19. Nota de segurança

O workflow n8n `wZnT8LSpRI6nTHD0` ("Closet Fit - buscar_produtos")
contém um **token Bearer da Dooca hardcoded em texto plano**. Recomenda-se
**rotacionar** o token e movê-lo para uma credencial do n8n. Esta
biblioteca não persiste nem requer esse token.

---

## 20. Referências

- Schema oficial: skill `nextags-json-fixer`, `references/schema.md`.
- Proxy de imagem de produção: workflow n8n `icBn6YHkd9hVERnc`
  ("Closet Fit - Proxy Imagem"), webhook `cf-img-proxy`.
- Uso de produção do proxy: workflow n8n `wZnT8LSpRI6nTHD0`
  (reescrita de URL via `cf-img-proxy?u=`).
