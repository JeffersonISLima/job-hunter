import type {
  IJobRepository,
  SaveJobInput,
  StoredJob,
} from '../../domain/ports/jobRepository';
import type { SqliteDatabase } from './database';

export class JobRepository implements IJobRepository {
  constructor(private readonly database: SqliteDatabase) {}

  isProcessed(link: string): boolean {
    const row = this.database.client
      .prepare('SELECT id FROM jobs WHERE link = ?')
      .get(link);
    return Boolean(row);
  }

  save(input: SaveJobInput): void {
    const {
      job,
      score,
      rankingPoints,
      reason,
      location = '',
      salary = '',
      summary = '',
      recruiterEmail = '',
      status = 'pending',
    } = input;

    this.database.client
      .prepare(
        `
      INSERT INTO jobs (
        link, title, company, snippet, description, location, salary,
        summary, recruiter_email, score, ranking_points, reason, verified_at, status
      ) VALUES (
        @link, @title, @company, @snippet, @description, @location, @salary,
        @summary, @recruiter_email, @score, @ranking_points, @reason, @verified_at, @status
      )
      ON CONFLICT(link) DO UPDATE SET
        title = excluded.title,
        company = excluded.company,
        snippet = excluded.snippet,
        description = excluded.description,
        location = excluded.location,
        salary = excluded.salary,
        summary = excluded.summary,
        recruiter_email = excluded.recruiter_email,
        score = excluded.score,
        ranking_points = excluded.ranking_points,
        reason = excluded.reason,
        verified_at = excluded.verified_at,
        status = CASE
          WHEN jobs.status = 'sent' THEN jobs.status
          ELSE excluded.status
        END
    `
      )
      .run({
        link: job.link,
        title: job.title,
        company: job.company || '',
        snippet: job.snippet || '',
        description: job.description || '',
        location: location || job.location || '',
        salary: salary || job.salary || '',
        summary,
        recruiter_email: recruiterEmail || job.recruiterEmail || '',
        score,
        ranking_points: rankingPoints,
        reason,
        verified_at: job.verifiedAt || '',
        status,
      });
  }

  getPending(limit: number): StoredJob[] {
    return this.database.client
      .prepare(
        `SELECT * FROM jobs
         WHERE status = 'pending'
         ORDER BY score DESC, ranking_points DESC, created_at ASC
         LIMIT ?`
      )
      .all(limit) as StoredJob[];
  }

  markSent(link: string): void {
    this.database.client
      .prepare(
        `UPDATE jobs
         SET status = 'sent', sent_at = datetime('now')
         WHERE link = ?`
      )
      .run(link);
  }

  purgeRetryableRejected(): number {
    const result = this.database.client
      .prepare(
        `DELETE FROM jobs
         WHERE status = 'rejected'
           AND (
             score = 0
             OR reason LIKE '%Rate limit%'
             OR reason LIKE '%429%'
             OR reason LIKE '%free-models-per-day%'
             OR reason LIKE '%Resposta vazia%'
             OR reason LIKE '%Erro desconhecido%'
             OR reason LIKE '%not valid JSON%'
             OR score >= 5
             OR (
               score >= 2.5
               AND (
                 lower(title) LIKE '%node%'
                 OR lower(title) LIKE '%nest%'
                 OR lower(title) LIKE '%backend%'
                 OR lower(title) LIKE '%back-end%'
                 OR lower(title) LIKE '%desenvolvedor%'
               )
               AND title NOT LIKE '%+%'
               AND lower(title) NOT LIKE '%vaga(s)%'
               AND lower(title) NOT LIKE '%jobs in%'
               AND lower(title) NOT LIKE '%vagas em%'
             )
           )`
      )
      .run();
    return result.changes;
  }

  reinstatePreferenceOnlyRejects(): number {
    const result = this.database.client
      .prepare(
        `UPDATE jobs
         SET
           status = 'pending',
           score = CASE WHEN score < 7 THEN 7 ELSE score END,
           reason = trim(
             reason || ' | Reaberta: empresas da lista são preferência, não requisito.'
           )
         WHERE status = 'rejected'
           AND title NOT LIKE '%+%'
           AND lower(title) NOT LIKE '%vaga(s)%'
           AND lower(title) NOT LIKE '%jobs in%'
           AND lower(title) NOT LIKE '%vagas em%'
           AND lower(title) NOT LIKE '%java%'
           AND lower(title) NOT LIKE '%baixa plataforma%'
           AND (
             lower(title) LIKE '%node%'
             OR lower(title) LIKE '%nest%'
           )
           AND (
             link LIKE '%programathor%'
             OR link LIKE '%querohome%'
             OR link LIKE '%remotar.com.br%'
             OR link LIKE '%gupy.io%'
             OR link LIKE '%indeed.com.br%'
             OR link LIKE '%vagas.com.br%'
             OR link LIKE '%br.linkedin.com%'
           )
           AND (
             score >= 5
             OR lower(reason) LIKE '%tier%'
             OR lower(reason) LIKE '%priorit%'
             OR lower(reason) LIKE '%setores priorit%'
             OR score >= 2.5
           )`
      )
      .run();
    return result.changes;
  }

  close(): void {
    this.database.close();
  }
}
