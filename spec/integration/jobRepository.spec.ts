import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '../../src/infrastructure/persistence/database';
import { JobRepository } from '../../src/infrastructure/persistence/jobRepository';
import { createJob } from '../helpers/factories';

describe('JobRepository + SqliteDatabase', () => {
  let database: SqliteDatabase;
  let repository: JobRepository;

  beforeEach(() => {
    database = new SqliteDatabase(':memory:');
    repository = new JobRepository(database);
  });

  afterEach(() => {
    repository.close();
  });

  it('salva e recupera vagas pending ordenadas por score', () => {
    const low = createJob({ link: 'https://example.com/low', title: 'Low' });
    const high = createJob({ link: 'https://example.com/high', title: 'High' });

    repository.save({
      job: low,
      score: 7,
      rankingPoints: 10,
      reason: 'ok',
      status: 'pending',
    });
    repository.save({
      job: high,
      score: 9,
      rankingPoints: 20,
      reason: 'forte',
      status: 'pending',
    });

    const pending = repository.getPending(10);

    expect(pending).toHaveLength(2);
    expect(pending[0].link).toBe(high.link);
    expect(pending[1].link).toBe(low.link);
  });

  it('marca link como processado após save', () => {
    const job = createJob();
    expect(repository.isProcessed(job.link)).toBe(false);

    repository.save({
      job,
      score: 8,
      rankingPoints: 30,
      reason: 'fit',
      status: 'pending',
    });

    expect(repository.isProcessed(job.link)).toBe(true);
  });

  it('marca pending como sent', () => {
    const job = createJob();
    repository.save({
      job,
      score: 8,
      rankingPoints: 30,
      reason: 'fit',
      status: 'pending',
    });

    repository.markSent(job.link);

    expect(repository.getPending(10)).toHaveLength(0);
    expect(repository.isProcessed(job.link)).toBe(true);
  });

  it('não rebaixa status sent em conflito de link', () => {
    const job = createJob();
    repository.save({
      job,
      score: 8,
      rankingPoints: 10,
      reason: 'enviada',
      status: 'pending',
    });
    repository.markSent(job.link);

    repository.save({
      job,
      score: 5,
      rankingPoints: 1,
      reason: 'reavaliada',
      status: 'rejected',
    });

    expect(repository.getPending(10)).toHaveLength(0);
    const row = database.client
      .prepare('SELECT status, score FROM jobs WHERE link = ?')
      .get(job.link) as { status: string; score: number };

    expect(row.status).toBe('sent');
    expect(row.score).toBe(5);
  });

  it('purge remove rejeições por rate limit', () => {
    repository.save({
      job: createJob({ link: 'https://example.com/rate' }),
      score: 0,
      rankingPoints: 0,
      reason: 'Rate limit 429',
      status: 'rejected',
    });

    const removed = repository.purgeRetryableRejected();

    expect(removed).toBe(1);
    expect(repository.isProcessed('https://example.com/rate')).toBe(false);
  });
});
