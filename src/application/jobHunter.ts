import config from '../config/config.json';
import type { IJobRepository } from '../domain/ports/jobRepository';
import type { IJobScraper } from '../domain/ports/jobScraper';
import type { IJobNotifier } from '../domain/ports/jobNotifier';
import type { IJobEvaluator } from '../domain/ports/jobEvaluator';
import { WebSearchSource } from '../infrastructure/sources/webSearchSource';
import {
  JobSpyBoardsSource,
  JobSpyLinkedInSource,
} from '../infrastructure/sources/jobSpySource';
import type { PipelineContext } from './pipeline/context';
import { HunterPipeline } from './pipeline/hunterPipeline';
import { PrepareStep } from './pipeline/prepareStep';
import { GatherAndCurateStep } from './pipeline/gatherAndCurateStep';
import { NotifyStep } from './pipeline/notifyStep';
import { CurateService } from './pipeline/curateStep';

export class JobHunter {
  private readonly context: PipelineContext;
  private readonly pipeline: HunterPipeline;

  constructor(
    private readonly repo: IJobRepository,
    private readonly scraper: IJobScraper,
    evaluator: IJobEvaluator,
    notifier: IJobNotifier,
    private readonly model: string,
    private readonly modelFallback?: string,
    private readonly baseURL: string = 'https://api.openai.com/v1'
  ) {
    const maxValid = config.maxAlertsPerRun;
    this.context = {
      repo,
      maxValid,
      minGatherJobs:
        typeof config.minGatherJobs === 'number'
          ? config.minGatherJobs
          : maxValid,
      minScore: config.minScore,
      stats: { processed: 0, eligible: 0 },
      curateStatus: 'ok',
      sent: 0,
      failedSend: 0,
    };

    const curateService = new CurateService(evaluator);
    this.pipeline = new HunterPipeline([
      new PrepareStep(),
      new GatherAndCurateStep(
        [
          new WebSearchSource(scraper),
          new JobSpyBoardsSource(scraper),
          new JobSpyLinkedInSource(scraper),
        ],
        curateService
      ),
      new NotifyStep(notifier),
    ]);
  }

  async run(): Promise<void> {
    console.log('=== Job Hunter iniciado ===');
    console.log(
      `Perfil: ${config.role} | minScore=${this.context.minScore} | maxValidas=${this.context.maxValid}`
    );
    console.log(`Modelo: ${this.model}`);
    if (this.modelFallback) {
      console.log(`Modelo fallback (rate limit): ${this.modelFallback}`);
      if (this.model.endsWith(':free') && this.modelFallback.endsWith(':free')) {
        console.warn(
          '[hunter] Aviso: primary e fallback são :free — compartilham o mesmo limite diário OpenRouter'
        );
      }
    }
    console.log(`API: ${this.baseURL}`);

    try {
      await this.pipeline.run(this.context);
    } finally {
      await this.scraper.close();
      this.repo.close();
    }

    console.log('=== Job Hunter finalizado ===');
    console.log(
      `Processadas: ${this.context.stats.processed} | Válidas: ${this.context.stats.eligible}/${this.context.maxValid} | Enviadas: ${this.context.sent} | Falhas Telegram: ${this.context.failedSend}`
    );
  }

  async shutdown(): Promise<void> {
    try {
      await this.scraper.close();
    } catch {}
    try {
      this.repo.close();
    } catch {}
  }
}
