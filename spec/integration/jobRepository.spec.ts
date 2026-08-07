import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
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

  it('trata URL com tracking e canônica como a mesma vaga', () => {
    const dirty =
      'https://montreal.gupy.io/jobs/11575472?jobBoardSource=gupypublicpage&utm_source=x';
    const clean = 'https://montreal.gupy.io/jobs/11575472';

    repository.save({
      job: createJob({ link: dirty, title: 'Node Pleno' }),
      score: 8,
      rankingPoints: 20,
      reason: 'fit',
      status: 'pending',
    });

    expect(repository.isProcessed(dirty)).toBe(true);
    expect(repository.isProcessed(clean)).toBe(true);

    const row = database.client
      .prepare('SELECT link FROM jobs WHERE link = ?')
      .get(clean) as { link: string };
    expect(row.link).toBe(clean);
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

  it('não reinstaura nem faz purge de vaga rejeitada como encerrada', () => {
    const job = createJob({
      link: 'https://montreal.gupy.io/jobs/11575472',
      title: 'Desenvolvedor Node.js Pleno',
      description: 'Candidaturas encerradas. Inscrições encerradas.',
    });

    repository.save({
      job,
      score: 0,
      rankingPoints: 0,
      reason: 'Vaga encerrada / candidaturas fechadas',
      status: 'rejected',
    });

    expect(repository.reinstatePreferenceOnlyRejects()).toBe(0);
    expect(repository.purgeRetryableRejected()).toBe(0);
    expect(repository.getPending(10)).toHaveLength(0);
    expect(repository.isProcessed(job.link)).toBe(true);
  });

  it('markRejected remove pending da fila', () => {
    const job = createJob({ link: 'https://example.com/closed' });
    repository.save({
      job,
      score: 8,
      rankingPoints: 20,
      reason: 'fit',
      status: 'pending',
    });

    repository.markRejected(job.link, 'Vaga encerrada / candidaturas fechadas');

    expect(repository.getPending(10)).toHaveLength(0);
    const row = database.client
      .prepare('SELECT status, score, reason FROM jobs WHERE link = ?')
      .get(job.link) as { status: string; score: number; reason: string };

    expect(row.status).toBe('rejected');
    expect(row.score).toBe(0);
    expect(row.reason).toBe('Vaga encerrada / candidaturas fechadas');
  });
});

describe('SqliteDatabase migrateCanonicalJobLinks', () => {
  let dbPath: string;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-hunter-'));
    dbPath = path.join(tempDir, 'jobs.db');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('migra link com query string e faz merge preferindo sent', () => {
    const first = new SqliteDatabase(dbPath);
    first.client
      .prepare(
        `INSERT INTO jobs (link, title, status, score) VALUES (?, ?, ?, ?)`
      )
      .run(
        'https://montreal.gupy.io/jobs/11575472?jobBoardSource=gupypublicpage',
        'Node Pleno',
        'sent',
        8
      );
    first.client
      .prepare(
        `INSERT INTO jobs (link, title, status, score) VALUES (?, ?, ?, ?)`
      )
      .run(
        'https://montreal.gupy.io/jobs/11575472',
        'Node Pleno dup',
        'rejected',
        0
      );
    first.close();

    const reopened = new SqliteDatabase(dbPath);
    const repo = new JobRepository(reopened);

    const rows = reopened.client
      .prepare('SELECT link, status FROM jobs')
      .all() as Array<{ link: string; status: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].link).toBe('https://montreal.gupy.io/jobs/11575472');
    expect(rows[0].status).toBe('sent');
    expect(
      repo.isProcessed(
        'https://montreal.gupy.io/jobs/11575472?jobBoardSource=gupypublicpage'
      )
    ).toBe(true);
    expect(repo.isProcessed('https://montreal.gupy.io/jobs/11575472')).toBe(
      true
    );

    repo.close();
  });
});
