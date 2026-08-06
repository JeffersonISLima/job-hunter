import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DEFAULT_DB_PATH = process.env.JOBS_DB_PATH || './data/jobs.db';

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
  }

  private static ensureDirectory(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
