import type { Diagnostic, Report, Stats } from '../types';
import { KIND_BY_PREFIX } from '../errors';

export interface ReportBuilder {
  repairs: Diagnostic[];
  warnings: Diagnostic[];
  errors: Diagnostic[];
  pending: Diagnostic[];
  push(d: Diagnostic): void;
  finalize(stats: Stats): Report;
}

export function createReport(): ReportBuilder {
  const b: ReportBuilder = {
    repairs: [],
    warnings: [],
    errors: [],
    pending: [],
    push(d) {
      const prefix = d.code.split('_')[0] ?? '';
      const kind = KIND_BY_PREFIX[prefix] ?? 'warning';
      const buckets = {
        repair: b.repairs,
        warning: b.warnings,
        error: b.errors,
        pending: b.pending,
      };
      buckets[kind].push(d);
    },
    finalize(stats) {
      return {
        repairs: b.repairs,
        warnings: b.warnings,
        errors: b.errors,
        pending: b.pending,
        stats,
      };
    },
  };
  return b;
}
