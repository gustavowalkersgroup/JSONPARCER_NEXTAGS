import type { NexTagsPayload, Simulation, TimelineEntry } from '../types';
import { classifyItem } from '../delays/classify';
import { computeStats } from './stats';

const ICON: Record<string, string> = {
  TEXT: '💬',
  IMAGE: '📷',
  VIDEO: '🎬',
  AUDIO: '🔊',
  FILE: '📎',
  TEMPLATE: '🟨',
};

// Constrói a linha do tempo: segundos acumulados (delays) + ícone por tipo.
export function buildSimulation(payload: NexTagsPayload): Simulation {
  const messages = payload.messages ?? [];
  let at = 0;
  let product = 0;
  const timeline: TimelineEntry[] = [];

  for (const it of messages) {
    if (typeof it === 'number') {
      at += it;
      continue;
    }
    const kind = classifyItem(it);
    if (kind === 'IMAGE') product++;
    const label =
      kind === 'IMAGE' || kind === 'TEMPLATE'
        ? `Produto ${product || 1}`
        : (it.message.text ?? '').slice(0, 40);
    timeline.push({ atSec: at, icon: ICON[kind] ?? '•', kind, label });
  }

  const stats = computeStats(payload, { repairs: [], warnings: [], errors: [], pending: [] });
  return {
    timeline,
    stats,
    render() {
      return timeline
        .map((e) => `${String(e.atSec).padStart(2, '0')}s ${e.icon} ${e.label}`)
        .join('\n');
    },
  };
}
