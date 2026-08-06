import type { JobListing } from '../job';

export interface ScoreResult {
  compatible: boolean;
  score: number;
  reason: string;
  location: string;
  salary: string;
  summary: string;
  recruiterEmail: string;
  rankingPoints: number;
  evaluationFailed?: boolean;
}

export interface IJobEvaluator {
  evaluate(job: JobListing): Promise<ScoreResult>;
}
