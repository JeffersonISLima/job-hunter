import type { JobListing } from '../../domain/job';
import type { IJobScraper } from '../../domain/ports/jobScraper';
import type { JobSource, SourceRequest } from './jobSource';

export class JobSpyBoardsSource implements JobSource {
  readonly name = 'jobspy-boards';

  constructor(private readonly scraper: IJobScraper) {}

  async search(req: SourceRequest): Promise<JobListing[]> {
    console.log(
      `[hunter] ${req.eligibleSoFar}/${req.maxValid} válidas — fallback JobSpy (sem LinkedIn)...`
    );
    return this.scraper.searchJobSpy({
      sites: ['indeed', 'glassdoor', 'google', 'linkedin'],
      searchTerm: 'Node.js OR NestJS backend pleno',
      location: 'Brazil',
      results: 8,
      googleSearchTerm: 'Node.js NestJS backend pleno remoto Brazil',
    });
  }
}

export class JobSpyLinkedInSource implements JobSource {
  readonly name = 'jobspy-linkedin';

  constructor(private readonly scraper: IJobScraper) {}

  async search(req: SourceRequest): Promise<JobListing[]> {
    console.log(
      `[hunter] ${req.eligibleSoFar}/${req.maxValid} válidas — JobSpy LinkedIn por último...`
    );
    return this.scraper.searchJobSpy({
      sites: ['linkedin'],
      searchTerm: 'Node.js NestJS backend',
      location: 'Brazil',
      results: 5,
    });
  }
}
