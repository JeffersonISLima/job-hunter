import type { JobListing } from '../../domain/job';
import type { IJobEvaluator } from '../../domain/ports/jobEvaluator';
import {
  CLOSED_JOB_REASON,
  isClosedJobText,
  jobTextBlob,
} from '../../infrastructure/scraping/jobValidation';
import type { CurateStatus, PipelineContext } from './context';

export class CurateService {
  constructor(private readonly evaluator: IJobEvaluator) {}

  async curateUntilValid(
    jobs: JobListing[],
    ctx: PipelineContext
  ): Promise<CurateStatus> {
    for (const job of jobs) {
      if (ctx.stats.eligible >= ctx.maxValid) {
        console.log(
          `[hunter] ${ctx.maxValid} vagas válidas atingidas — parando busca/curadoria`
        );
        return 'ok';
      }

      if (ctx.repo.isProcessed(job.link)) {
        console.log(`[skip] Já processada: ${job.link}`);
        continue;
      }

      ctx.stats.processed += 1;
      console.log(`[eval] ${job.title} — ${job.company}`);

      if (
        isClosedJobText(
          jobTextBlob([job.title, job.snippet, job.description])
        )
      ) {
        ctx.repo.save({
          job,
          score: 0,
          rankingPoints: 0,
          reason: CLOSED_JOB_REASON,
          status: 'rejected',
        });
        console.log(`[reject] ${CLOSED_JOB_REASON}: ${job.title}`);
        continue;
      }

      const result = await this.evaluator.evaluate(job);
      if (this.evaluator.usedFallbackModel()) {
        ctx.usedLlmFallback = true;
      }
      console.log(
        `[score] ${result.score}/10 compatible=${result.compatible} points=${result.rankingPoints}`
      );

      if (result.evaluationFailed) {
        ctx.stats.processed -= 1;
        console.warn(
          `[hunter] Avaliação falhou (não persistida): ${result.reason.slice(0, 120)}`
        );
        if (/rate limit|429|free-models-per-day/i.test(result.reason)) {
          console.warn(
            '[hunter] Rate limit da API — interrompendo curadoria nesta run (vagas não marcadas como rejected)'
          );
          return 'rate_limited';
        }
        continue;
      }

      if (!result.compatible || result.score < ctx.minScore) {
        ctx.repo.save({
          job,
          score: result.score,
          rankingPoints: result.rankingPoints,
          reason: result.reason,
          location: result.location,
          salary: result.salary,
          summary: result.summary,
          recruiterEmail: result.recruiterEmail,
          status: 'rejected',
        });
        continue;
      }

      ctx.stats.eligible += 1;
      ctx.repo.save({
        job,
        score: result.score,
        rankingPoints: result.rankingPoints,
        reason: result.reason,
        location: result.location,
        salary: result.salary,
        summary: result.summary,
        recruiterEmail: result.recruiterEmail,
        status: 'pending',
      });
      console.log(
        `[hunter] Válidas nesta run: ${ctx.stats.eligible}/${ctx.maxValid}`
      );
    }

    return 'ok';
  }
}
