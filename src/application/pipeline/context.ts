import type { IJobRepository } from '../../domain/ports/jobRepository';

export type CurateStatus = 'ok' | 'rate_limited';

export interface HuntStats {
  processed: number;
  eligible: number;
}

export interface PipelineContext {
  repo: IJobRepository;
  maxValid: number;
  minGatherJobs: number;
  minScore: number;
  stats: HuntStats;
  curateStatus: CurateStatus;
  sent: number;
  failedSend: number;
}

export interface PipelineStep {
  readonly name: string;
  run(ctx: PipelineContext): Promise<void>;
}
