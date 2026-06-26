import type { NexTagsPayload, Report, Stats } from '../types';
import { detectProducts } from '../delays/blocks';

export function computeStats(
  payload: NexTagsPayload,
  report: Pick<Report, 'repairs' | 'warnings' | 'errors' | 'pending'>,
): Stats {
  const messages = payload.messages ?? [];
  let totalDurationSec = 0;
  let imageCount = 0;
  let messageCount = 0;
  let delayCount = 0;

  for (const it of messages) {
    if (typeof it === 'number') {
      totalDurationSec += it;
      delayCount++;
      continue;
    }
    messageCount++;
    if (it.message.attachment?.type === 'image') imageCount++;
  }

  const productCount = detectProducts(messages.filter((m) => typeof m !== 'number')).cardPairs
    .length;

  return {
    totalDurationSec,
    productCount,
    imageCount,
    messageCount,
    delayCount,
    repairCount: report.repairs.length,
    warningCount: report.warnings.length,
    errorCount: report.errors.length,
    pendingCount: report.pending.length,
  };
}
