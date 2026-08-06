import config from '../../config/config.json';
import type { JobListing } from '../../domain/job';
import type { IJobScraper } from '../../domain/ports/jobScraper';
import type { JobSource, SourceRequest } from './jobSource';

export class WebSearchSource implements JobSource {
  readonly name = 'web-search';

  constructor(private readonly scraper: IJobScraper) {}

  async search(req: SourceRequest): Promise<JobListing[]> {
    return this.scraper.gatherJobs(
      config.queries,
      config.fallbackQueries || [],
      req.minGatherJobs
    );
  }
}
