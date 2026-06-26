// =============================================================================
// Exemplo de Code node n8n (card) — whatsapp-ai-middleware
// =============================================================================
//
// 1. Abra dist/card.global.js (gerado por `npm run build`).
// 2. Cole TODO o conteúdo dele no TOPO deste Code node (antes destas linhas).
//    Ele expõe a global `WAMW`.
// 3. Ajuste `clientField` para o nome do campo que vai pro cliente no seu fluxo.
//
// O Code node recebe a saída crua da IA em algum campo de $json
// (aqui assumimos $json.iaOutput). Troque pelo seu campo real.
// -----------------------------------------------------------------------------

const result = WAMW.process($json.iaOutput, {
  image: {
    strategy: 'proxy',
    proxyBase: 'https://nextags.app.br/webhook/cf-img-proxy',
  },
  delays: { intraCard: 4, interProduct: 7, bubble: 4 },
  fallback: {
    message: 'Só um instante que já te respondo 😊',
    handoff: { action: 'send_flow', flow_id: 'SEU_FLOW_ID_DE_HANDOFF' },
  },
});

// `resposta` → SOMENTE o JSON validado (vai pro cliente).
// `_debug`   → relatório/diagnóstico (campo interno; NUNCA enviar ao cliente).
return [
  {
    json: WAMW.toCardOutput(result, { clientField: 'resposta', debugField: '_debug' }),
  },
];
