import config from '../config/config.json';
import { JobHunter } from '../application/jobHunter';
import { JobRepository } from '../infrastructure/persistence/jobRepository';
import { SqliteDatabase } from '../infrastructure/persistence/database';
import { JobCurator } from '../infrastructure/llm/curator';
import { TelegramNotifier } from '../infrastructure/messaging/telegram';
import { JobScraper } from '../infrastructure/scraping/scraper';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export function createJobHunterFromEnv(): JobHunter {
  requireEnv('OPENAI_API_KEY');
  requireEnv('TELEGRAM_BOT_TOKEN');
  requireEnv('TELEGRAM_CHAT_ID');

  const database = new SqliteDatabase();
  const repository = new JobRepository(database);

  return new JobHunter(
    repository,
    new JobScraper(),
    new JobCurator(),
    new TelegramNotifier(),
    process.env.OPENAI_MODEL || config.model,
    process.env.OPENAI_MODEL_FALLBACK,
    process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  );
}
