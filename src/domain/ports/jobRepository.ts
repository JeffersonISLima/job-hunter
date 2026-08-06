import type { JobListing } from '../job';

export type JobStatus = 'pending' | 'sent' | 'rejected';

export interface StoredJob {
  id: number;
  link: string;
  title: string;
  company: string;
  snippet: string;
  description: string;
  location: string;
  salary: string;
  summary: string;
  recruiter_email: string;
  score: number;
  ranking_points: number;
  reason: string;
  verified_at: string;
  status: JobStatus;
  sent_at: string | null;
  created_at: string;
}

export interface SaveJobInput {
  job: JobListing;
  score: number;
  rankingPoints: number;
  reason: string;
  location?: string;
  salary?: string;
  summary?: string;
  recruiterEmail?: string;
  status?: JobStatus;
}

export interface IJobRepository {
  isProcessed(link: string): boolean;
  save(input: SaveJobInput): void;
  getPending(limit: number): StoredJob[];
  markSent(link: string): void;
  purgeRetryableRejected(): number;
  reinstatePreferenceOnlyRejects(): number;
  close(): void;
}
