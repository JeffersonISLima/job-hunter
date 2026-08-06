import type { JobListing } from '../../domain/job';

export interface SourceRequest {
  minGatherJobs: number;
  maxValid: number;
  eligibleSoFar: number;
}

export interface JobSource {
  readonly name: string;
  search(req: SourceRequest): Promise<JobListing[]>;
}
