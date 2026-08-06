import type { JobSource } from '../../infrastructure/sources/jobSource';
import type { PipelineContext, PipelineStep } from './context';
import type { CurateService } from './curateStep';

export class GatherAndCurateStep implements PipelineStep {
  readonly name = 'gather-and-curate';

  constructor(
    private readonly sources: JobSource[],
    private readonly curateService: CurateService
  ) {}

  async run(ctx: PipelineContext): Promise<void> {
    for (const source of this.sources) {
      if (ctx.curateStatus !== 'ok' || ctx.stats.eligible >= ctx.maxValid) {
        break;
      }

      console.log(`[pipeline] fonte=${source.name}`);
      const jobs = await source.search({
        minGatherJobs: ctx.minGatherJobs,
        maxValid: ctx.maxValid,
        eligibleSoFar: ctx.stats.eligible,
      });
      const fresh = jobs.filter((job) => !ctx.repo.isProcessed(job.link));
      ctx.curateStatus = await this.curateService.curateUntilValid(fresh, ctx);
    }
  }
}
