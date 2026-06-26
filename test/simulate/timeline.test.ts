import { expect, test } from 'vitest';
import { buildSimulation } from '../../src/simulate/timeline';

test('renders timeline with cumulative seconds', () => {
  const sim = buildSimulation({
    messages: [
      { message: { attachment: { type: 'image', payload: { url: 'u' } } } },
      4,
      { message: { attachment: { type: 'template', payload: { template_type: 'button', text: 't' } } } },
    ],
  });
  expect(sim.stats.totalDurationSec).toBe(4);
  expect(sim.stats.productCount).toBe(1);
  expect(sim.render()).toContain('00s 📷');
  expect(sim.render()).toContain('04s 🟨');
});
