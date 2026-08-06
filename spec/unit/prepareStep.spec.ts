import { describe, expect, it, vi } from 'vitest';
import { PrepareStep } from '../../src/application/pipeline/prepareStep';
import { createContext, createMockRepository } from '../helpers/factories';

describe('PrepareStep', () => {
  it('reabre rejeições por preferência e limpa rejeições reavaliáveis', async () => {
    const repo = createMockRepository({
      reinstatePreferenceOnlyRejects: vi.fn().mockReturnValue(2),
      purgeRetryableRejected: vi.fn().mockReturnValue(1),
    });
    const step = new PrepareStep();

    await step.run(createContext({ repo }));

    expect(repo.reinstatePreferenceOnlyRejects).toHaveBeenCalledOnce();
    expect(repo.purgeRetryableRejected).toHaveBeenCalledOnce();
  });
});
