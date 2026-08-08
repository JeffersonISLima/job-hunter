import type { JobListing } from '../job';
import type { ScoreResult } from './jobEvaluator';
import type { StoredJob } from './jobRepository';

export interface AlertPayload {
  title: string;
  company: string;
  link: string;
  location: string;
  salary: string;
  summary: string;
  reason: string;
  score: number;
  rankingPoints: number;
  verifiedAt: string;
  recruiterEmail: string;
}

export interface IJobNotifier {
  alertFromStored(job: StoredJob): AlertPayload;
  alertFromListing(job: JobListing, result: ScoreResult): AlertPayload;
  sendJobAlert(alert: AlertPayload, maxAttempts?: number): Promise<void>;
  sendNoJobsStatus(date?: Date): Promise<void>;
  sendLlmFallbackNotice(
    primaryModel: string,
    fallbackModel: string
  ): Promise<void>;
}
