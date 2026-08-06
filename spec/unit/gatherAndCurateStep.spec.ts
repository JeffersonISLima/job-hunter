import { describe, expect, it, vi } from 'vitest';
import { GatherAndCurateStep } from '../../src/application/pipeline/gatherAndCurateStep';
import { CurateService } from '../../src/application/pipeline/curateStep';
import type { JobSource } from '../../src/infrastructure/sources/jobSource';
import {
  createContext,
  createJob,
  createMockRepository,
} from '../helpers/factories';

describe('GatherAndCurateStep', () => {
  it('busca nas fontes, filtra processadas e cura o lote', async () => {
    const fresh = createJob({ link: 'https://example.com/fresh' });
    const known = createJob({ link: 'https://example.com/known' });
    const source: JobSource = {
      name: 'web-search',
      search: vi.fn().mockResolvedValue([fresh, known]),
    };
    const repo = createMockRepository({
      isProcessed: vi.fn((link: string) => link.includes('known')),
    });
    const curateUntilValid = vi.fn().mockResolvedValue('ok');
    const curateService = {
      curateUntilValid,
    } as unknown as CurateService;
    const step = new GatherAndCurateStep([source], curateService);
    const ctx = createContext({ repo, maxValid: 3 });

    await step.run(ctx);

    expect(source.search).toHaveBeenCalledWith({
      minGatherJobs: ctx.minGatherJobs,
      maxValid: ctx.maxValid,
      eligibleSoFar: 0,
    });
    expect(curateUntilValid).toHaveBeenCalledWith([fresh], ctx);
  });

  it('não consulta próxima fonte após rate limit', async () => {
    const first: JobSource = {
      name: 'web-search',
      search: vi.fn().mockResolvedValue([createJob()]),
    };
    const second: JobSource = {
      name: 'jobspy',
      search: vi.fn().mockResolvedValue([]),
    };
    const curateService = {
      curateUntilValid: vi.fn().mockResolvedValue('rate_limited'),
    } as unknown as CurateService;
    const step = new GatherAndCurateStep([first, second], curateService);
    const ctx = createContext();

    await step.run(ctx);

    expect(first.search).toHaveBeenCalledOnce();
    expect(second.search).not.toHaveBeenCalled();
    expect(ctx.curateStatus).toBe('rate_limited');
  });

  it('para quando já atingiu maxValid', async () => {
    const source: JobSource = {
      name: 'web-search',
      search: vi.fn(),
    };
    const step = new GatherAndCurateStep([source], {
      curateUntilValid: vi.fn(),
    } as unknown as CurateService);
    const ctx = createContext({
      maxValid: 2,
      stats: { processed: 2, eligible: 2 },
    });

    await step.run(ctx);

    expect(source.search).not.toHaveBeenCalled();
  });
});
