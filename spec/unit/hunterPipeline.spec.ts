import { describe, expect, it, vi } from 'vitest';
import { HunterPipeline } from '../../src/application/pipeline/hunterPipeline';
import type { PipelineStep } from '../../src/application/pipeline/context';
import { createContext } from '../helpers/factories';

describe('HunterPipeline', () => {
  it('executa os steps na ordem', async () => {
    const order: string[] = [];
    const steps: PipelineStep[] = [
      {
        name: 'first',
        run: vi.fn(async () => {
          order.push('first');
        }),
      },
      {
        name: 'second',
        run: vi.fn(async () => {
          order.push('second');
        }),
      },
    ];
    const pipeline = new HunterPipeline(steps);
    const ctx = createContext();

    await pipeline.run(ctx);

    expect(order).toEqual(['first', 'second']);
    expect(steps[0].run).toHaveBeenCalledWith(ctx);
    expect(steps[1].run).toHaveBeenCalledWith(ctx);
  });
});
