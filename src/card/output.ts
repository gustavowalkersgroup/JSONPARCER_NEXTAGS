import type { Result } from '../types';

// Guard-rail anti-vazamento: separa fisicamente o que vai pro cliente (apenas
// data) do diagnóstico interno (report/simulation). É impossível o report cair
// no campo do cliente.
export function toCardOutput(
  result: Result,
  opts: { clientField?: string; debugField?: string; stringify?: boolean } = {},
): Record<string, unknown> {
  const clientField = opts.clientField ?? 'resposta';
  const debugField = opts.debugField ?? '_debug';
  const stringify = opts.stringify ?? true;
  const data = result.data ?? {};
  return {
    [clientField]: stringify ? JSON.stringify(data) : data,
    [debugField]: {
      ok: result.ok,
      report: result.report,
      ...(result.simulation ? { simulation: result.simulation.timeline } : {}),
    },
  };
}
