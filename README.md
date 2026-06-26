# whatsapp-ai-middleware

Middleware robusto entre a saída de um modelo de IA (Claude) e o MCP do WhatsApp
da plataforma **NexTags Messenger**. Recebe a resposta crua da IA —
possivelmente imperfeita — e devolve um JSON **válido, normalizado e com delays
sincronizados**, mais um relatório de diagnóstico **separado**.

Resolve três problemas:

1. **JSON malformado** (fence markdown, truncamento, vírgulas/aspas erradas,
   objetos incompletos) → reparo híbrido (parser tolerante próprio + fallback).
2. **Mídia assíncrona fora de ordem** → inserção inteligente de delays entre
   blocos `imagem → template`.
3. **Imagens WebP** que quebram a entrega → reescrita via proxy de conversão.

E nunca vaza diagnóstico ao cliente: a saída do cliente recebe **apenas** o
payload validado (ou um fallback seguro).

## Instalação

```bash
npm install whatsapp-ai-middleware
```

## Uso (Node)

```ts
import { process, toCardOutput } from 'whatsapp-ai-middleware';

const result = process(rawModelOutput, {
  image: { proxyBase: 'https://nextags.app.br/webhook/cf-img-proxy' },
  delays: { intraCard: 4, interProduct: 7 },
  fallback: { message: 'Só um instante 😊', handoff: { action: 'send_flow', flow_id: '123' } },
});

if (result.ok) {
  sendToWhatsapp(result.data); // payload pronto
}
console.debug(result.report); // diagnóstico — nunca enviado ao cliente
```

## Uso no Code node do n8n (card)

Como o Code node não faz `npm install`, use o bundle autossuficiente
`dist/card.global.js` (com zod e jsonrepair embutidos). Cole o conteúdo do
bundle no topo do Code node e depois:

```js
// (conteúdo de dist/card.global.js colado acima — expõe a global WAMW)
const result = WAMW.process($json.iaOutput, {
  image: { proxyBase: 'https://nextags.app.br/webhook/cf-img-proxy' },
});
return [{ json: WAMW.toCardOutput(result, { clientField: 'resposta', debugField: '_debug' }) }];
```

- `resposta` → string JSON pronta para o canal (somente o payload).
- `_debug` → relatório (`ok`, `report`, `simulation?`). Mantenha em campo
  interno; **nunca** envie ao cliente.

Veja `examples/n8n-code-node.js`.

## Contrato de saída

```ts
interface Result {
  ok: boolean;            // false = não recuperável; data vira fallback seguro
  data?: NexTagsPayload;  // JSON normalizado pronto pro MCP
  report: {
    repairs: Diagnostic[];   // o que foi consertado
    warnings: Diagnostic[];  // ambiguidade de bloco, >1 web_url, CTA>20…
    errors: Diagnostic[];    // por que falhou (se !ok)
    pending: Diagnostic[];   // requer ação humana (imagem não-garantível…)
    stats: Stats;
  };
  simulation?: Simulation;   // se options.simulate === true
}
```

## Opções (`MiddlewareOptions`)

| Caminho | Default | Descrição |
|---|---|---|
| `image.strategy` | `'proxy'` | `'proxy'` reescreve via `proxyBase`; `'detect-only'` aplica a regra de ouro |
| `image.proxyBase` | `''` | Base do proxy de conversão (ex.: `…/cf-img-proxy`) |
| `image.stripQuery` | `true` | Remove query string da URL antes de rotear |
| `image.removeUnverifiable` | `true` | Remove imagem não-garantível quando sem proxy |
| `delays.intraCard` | `4` | Segundos entre imagem→template do mesmo card |
| `delays.interProduct` | `7` | Segundos antes da imagem de um novo produto |
| `delays.bubble` | `4` | Segundos nas demais transições |
| `delays.perTransition` | `{}` | Override fino por tipo de transição |
| `fallback.message` | `'Só um instante…'` | Mensagem segura ao cliente em falha |
| `fallback.handoff` | `null` | Ação de handoff em falha (`send_flow`/`transfer_conversation_to`) |
| `normalize.stripStandardMarkdown` | `true` | Remove markdown-padrão (preserva WA-markup) |
| `parser.useFallbackLibrary` | `true` | Usa `jsonrepair` como último recurso |
| `simulate` | `false` | Produz `result.simulation` |

## Modo simulação

```ts
const r = process(raw, { simulate: true });
console.log(r.simulation.render());
// 00s 📷 Produto 1
// 04s 🟨 Produto 1
// 11s 📷 Produto 2
// ...
console.log(r.simulation.stats); // tempo total, produtos, imagens, delays, warnings…
```

## Proxy de imagem

A conversão WebP→JPEG roda num serviço Node separado (não no card). O proxy
tenta negociação de formato (header `Accept`, query `?format=jpg`) e, se ainda
vier WebP, transcodifica com `sharp`. Cobre Shopify, Dooca e outros CDNs.

```ts
import { createProxyHandler } from 'whatsapp-ai-middleware/proxy';

const handler = createProxyHandler();
// monte em Express/Fetch: GET /cf-img-proxy?u=<url> → responde JPEG/PNG
const { body, contentType } = await handler(req.query.u);
```

`sharp` é `optionalDependency` — instale-o no serviço de proxy.

## Integridade (garantia central)

A biblioteca **nunca** reassocia a imagem de um produto ao template de outro,
nem reordena mensagens. Só insere delays e normaliza. Qualquer ambiguidade
(imagem órfã, duas imagens seguidas) vira `warning`, preservando a sequência
original.

## Desenvolvimento

```bash
npm install
npm test        # vitest
npm run typecheck
npm run build    # gera dist/ (npm dual, proxy, card.global.js)
```
