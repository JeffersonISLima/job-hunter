import type { JobListing } from '../job';

export interface JobSpyOptions {
  sites: string[];
  searchTerm?: string;
  location?: string;
  results?: number;
  googleSearchTerm?: string;
}

export interface IJobScraper {
  gatherJobs(
    queries: string[],
    fallbackQueries?: string[],
    minJobs?: number
  ): Promise<JobListing[]>;
  searchJobSpy(options: JobSpyOptions): Promise<JobListing[]>;
  close(): Promise<void>;
}
