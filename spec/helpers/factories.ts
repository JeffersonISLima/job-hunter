import { vi } from 'vitest';
import type { JobListing } from '../../src/domain/job';
import type { ScoreResult } from '../../src/domain/ports/jobEvaluator';
import type { IJobRepository, StoredJob } from '../../src/domain/ports/jobRepository';
import type { IJobNotifier, AlertPayload } from '../../src/domain/ports/jobNotifier';
import type { PipelineContext } from '../../src/application/pipeline/context';

export function createJob(overrides: Partial<JobListing> = {}): JobListing {
  return {
    title: 'Desenvolvedor Node.js Pleno',
    company: 'Acme',
    link: 'https://example.com/jobs/1',
    snippet: 'Vaga remota Brasil',
    ...overrides,
  };
}

export function createScoreResult(
  overrides: Partial<ScoreResult> = {}
): ScoreResult {
  return {
    compatible: true,
    score: 8,
    reason: 'Fit com perfil',
    location: 'Remoto',
    salary: 'Não informado',
    summary: 'Backend Node.js',
    recruiterEmail: '',
    rankingPoints: 40,
    ...overrides,
  };
}

export function createStoredJob(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: 1,
    link: 'https://example.com/jobs/1',
    title: 'Desenvolvedor Node.js Pleno',
    company: 'Acme',
    snippet: 'Vaga remota',
    description: '',
    location: 'Remoto',
    salary: 'Não informado',
    summary: 'Backend Node.js',
    recruiter_email: '',
    score: 8,
    ranking_points: 40,
    reason: 'Fit',
    verified_at: '04/08/2026',
    status: 'pending',
    sent_at: null,
    created_at: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

export function createMockRepository(
  overrides: Partial<IJobRepository> = {}
): IJobRepository {
  return {
    isProcessed: vi.fn().mockReturnValue(false),
    save: vi.fn(),
    getPending: vi.fn().mockReturnValue([]),
    markSent: vi.fn(),
    purgeRetryableRejected: vi.fn().mockReturnValue(0),
    reinstatePreferenceOnlyRejects: vi.fn().mockReturnValue(0),
    close: vi.fn(),
    ...overrides,
  };
}

export function createMockNotifier(
  overrides: Partial<IJobNotifier> = {}
): IJobNotifier {
  return {
    alertFromStored: vi.fn(
      (job: StoredJob): AlertPayload => ({
        title: job.title,
        company: job.company,
        link: job.link,
        location: job.location,
        salary: job.salary,
        summary: job.summary,
        reason: job.reason,
        score: job.score,
        rankingPoints: job.ranking_points,
        verifiedAt: job.verified_at,
        recruiterEmail: job.recruiter_email,
      })
    ),
    alertFromListing: vi.fn(),
    sendJobAlert: vi.fn().mockResolvedValue(undefined),
    sendNoJobsStatus: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

export function createContext(
  overrides: Partial<PipelineContext> = {}
): PipelineContext {
  return {
    repo: createMockRepository(),
    maxValid: 3,
    minGatherJobs: 5,
    minScore: 7,
    stats: { processed: 0, eligible: 0 },
    curateStatus: 'ok',
    sent: 0,
    failedSend: 0,
    ...overrides,
  };
}
