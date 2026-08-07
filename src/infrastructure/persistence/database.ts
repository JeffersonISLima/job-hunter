import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { canonicalizeJobLink } from '../scraping/jobValidation';

const DEFAULT_DB_PATH = process.env.JOBS_DB_PATH || './data/jobs.db';

type JobLinkRow = {
  id: number;
  link: string;
  status: string;
};

const STATUS_RANK: Record<string, number> = {
  sent: 3,
  pending: 2,
  rejected: 1,
};

function preferJobRow(a: JobLinkRow, b: JobLinkRow): JobLinkRow {
  const rankA = STATUS_RANK[a.status] ?? 0;
  const rankB = STATUS_RANK[b.status] ?? 0;
  if (rankA !== rankB) return rankA > rankB ? a : b;
  return a.id <= b.id ? a : b;
}

export class SqliteDatabase {
  private readonly connection: Database.Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    if (dbPath !== ':memory:') {
      SqliteDatabase.ensureDirectory(dbPath);
    }
    this.connection = new Database(dbPath);
    this.migrate();
  }

  get client(): Database.Database {
    return this.connection;
  }

  close(): void {
    this.connection.close();
  }

  private migrate(): void {
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        link TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        company TEXT NOT NULL DEFAULT '',
        snippet TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        salary TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        recruiter_email TEXT NOT NULL DEFAULT '',
        score REAL NOT NULL DEFAULT 0,
        ranking_points INTEGER NOT NULL DEFAULT 0,
        reason TEXT NOT NULL DEFAULT '',
        verified_at TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        sent_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    this.migrateCanonicalJobLinks();
  }

  private migrateCanonicalJobLinks(): void {
    const rows = this.connection
      .prepare('SELECT id, link, status FROM jobs')
      .all() as JobLinkRow[];

    if (rows.length === 0) return;

    type Group = { keep: JobLinkRow; canonical: string; dropIds: number[] };
    const groups = new Map<string, Group>();

    for (const row of rows) {
      const canonical = canonicalizeJobLink(row.link) ?? row.link;
      const existing = groups.get(canonical);
      if (!existing) {
        groups.set(canonical, { keep: row, canonical, dropIds: [] });
        continue;
      }
      const winner = preferJobRow(existing.keep, row);
      const loser = winner.id === existing.keep.id ? row : existing.keep;
      existing.keep = winner;
      existing.dropIds.push(loser.id);
    }

    const updateLink = this.connection.prepare(
      'UPDATE jobs SET link = ? WHERE id = ?'
    );
    const deleteById = this.connection.prepare('DELETE FROM jobs WHERE id = ?');

    let updated = 0;
    let removed = 0;

    const run = this.connection.transaction(() => {
      for (const group of groups.values()) {
        for (const id of group.dropIds) {
          deleteById.run(id);
          removed += 1;
        }
        if (group.keep.link !== group.canonical) {
          updateLink.run(group.canonical, group.keep.id);
          updated += 1;
        }
      }
    });

    run();

    if (updated > 0 || removed > 0) {
      console.log(
        `[db] links canônicos: ${updated} atualizado(s), ${removed} duplicata(s) removida(s)`
      );
    }
  }

  private static ensureDirectory(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
