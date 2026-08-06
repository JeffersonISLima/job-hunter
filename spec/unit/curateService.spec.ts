import { describe, expect, it, vi } from 'vitest';
import { CurateService } from '../../src/application/pipeline/curateStep';
import type { IJobEvaluator } from '../../src/domain/ports/jobEvaluator';
import {
  createContext,
  createJob,
  createMockRepository,
  createScoreResult,
} from '../helpers/factories';

describe('CurateService', () => {
  it('persiste vaga elegível como pending e incrementa contadores', async () => {
    const repo = createMockRepository();
    const evaluator: IJobEvaluator = {
      evaluate: vi.fn().mockResolvedValue(createScoreResult({ score: 8 })),
    };
    const service = new CurateService(evaluator);
    const ctx = createContext({ repo, minScore: 7, maxValid: 3 });
    const job = createJob();

    const status = await service.curateUntilValid([job], ctx);

    expect(status).toBe('ok');
    expect(ctx.stats.processed).toBe(1);
    expect(ctx.stats.eligible).toBe(1);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ job, status: 'pending', score: 8 })
    );
  });

  it('persiste vaga abaixo do minScore como rejected', async () => {
    const repo = createMockRepository();
    const evaluator: IJobEvaluator = {
      evaluate: vi
        .fn()
        .mockResolvedValue(
          createScoreResult({ compatible: true, score: 5, reason: 'Fraco' })
        ),
    };
    const service = new CurateService(evaluator);
    const ctx = createContext({ repo, minScore: 7 });

    await service.curateUntilValid([createJob()], ctx);

    expect(ctx.stats.eligible).toBe(0);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'rejected', score: 5 })
    );
  });

  it('ignora vagas já processadas', async () => {
    const repo = createMockRepository({
      isProcessed: vi.fn().mockReturnValue(true),
    });
    const evaluate = vi.fn();
    const service = new CurateService({ evaluate });
    const ctx = createContext({ repo });

    await service.curateUntilValid([createJob()], ctx);

    expect(evaluate).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(ctx.stats.processed).toBe(0);
  });

  it('para ao atingir maxValid', async () => {
    const repo = createMockRepository();
    const evaluate = vi.fn().mockResolvedValue(createScoreResult({ score: 9 }));
    const service = new CurateService({ evaluate });
    const ctx = createContext({
      repo,
      maxValid: 1,
      stats: { processed: 0, eligible: 1 },
    });

    const status = await service.curateUntilValid(
      [createJob({ link: 'https://example.com/a' })],
      ctx
    );

    expect(status).toBe('ok');
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('retorna rate_limited quando a avaliação falha por rate limit', async () => {
    const repo = createMockRepository();
    const service = new CurateService({
      evaluate: vi.fn().mockResolvedValue(
        createScoreResult({
          evaluationFailed: true,
          reason: 'Rate limit 429 free-models-per-day',
          score: 0,
          compatible: false,
        })
      ),
    });
    const ctx = createContext({ repo });

    const status = await service.curateUntilValid([createJob()], ctx);

    expect(status).toBe('rate_limited');
    expect(repo.save).not.toHaveBeenCalled();
    expect(ctx.stats.processed).toBe(0);
  });

  it('continua após falha de avaliação sem rate limit', async () => {
    const repo = createMockRepository();
    const service = new CurateService({
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(
          createScoreResult({
            evaluationFailed: true,
            reason: 'Resposta vazia do modelo',
            score: 0,
            compatible: false,
          })
        )
        .mockResolvedValueOnce(createScoreResult({ score: 8 })),
    });
    const ctx = createContext({ repo });

    const status = await service.curateUntilValid(
      [
        createJob({ link: 'https://example.com/1' }),
        createJob({ link: 'https://example.com/2', title: 'NestJS Pleno' }),
      ],
      ctx
    );

    expect(status).toBe('ok');
    expect(ctx.stats.eligible).toBe(1);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });
});
