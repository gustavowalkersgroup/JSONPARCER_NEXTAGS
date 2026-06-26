import type { Action, MiddlewareOptions, NexTagsPayload, ResolvedOptions, Result } from '../types';
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
import { Codes, IrrecoverableError } from '../errors';

function fallbackPayload(opts: ResolvedOptions): NexTagsPayload {
  const p: NexTagsPayload = { messages: [{ message: { text: opts.fallback.message } }] };
  if (opts.fallback.handoff) p.actions = [opts.fallback.handoff as Action];
  return p;
}

// Orquestrador: string crua do modelo → Result seguro. Em falha irrecuperável,
// devolve ok:false com payload de fallback (mensagem segura + handoff).
export function process(raw: string, options: MiddlewareOptions = {}): Result {
  const opts = resolveOptions(options);
  const report = createReport();

  try {
    const parsed = parseRecover(raw, opts);
    parsed.repairs.forEach((d) => report.push(d));

    const coerced = coerceStructure(parsed.value);
    coerced.diagnostics.forEach((d) => report.push(d));
    if (coerced.fatal) {
      throw new IrrecoverableError('Raiz sem messages nem actions', Codes.ERR_ROOT_EMPTY);
    }
    let payload = coerced.value;

    const v = validatePayload(payload);
    v.diagnostics.forEach((d) => report.push(d));
    payload = v.payload;

    const t = normalizePayloadText(payload, opts);
    t.diagnostics.forEach((d) => report.push(d));
    payload = t.payload;

    const im = rewriteImages(payload, opts);
    im.diagnostics.forEach((d) => report.push(d));
    payload = im.payload;

    if (payload.messages) {
      const dl = insertDelays(payload.messages, opts);
      dl.diagnostics.forEach((d) => report.push(d));
      payload.messages = dl.messages;
    }

    const stats = computeStats(payload, report);
    const result: Result = { ok: true, data: payload, report: report.finalize(stats) };
    if (opts.simulate) result.simulation = buildSimulation(payload);
    return result;
  } catch (e) {
    const err =
      e instanceof IrrecoverableError
        ? e
        : new IrrecoverableError(String(e), Codes.ERR_IRRECOVERABLE_JSON);
    report.push({ code: err.code, message: err.message, fatal: true, detail: err.detail });
    const data = fallbackPayload(opts);
    const stats = computeStats(data, report);
    const result: Result = { ok: false, data, report: report.finalize(stats) };
    if (opts.simulate) result.simulation = buildSimulation(data);
    return result;
  }
}
