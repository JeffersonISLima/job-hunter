import 'dotenv/config';
import { createJobHunterFromEnv } from './bootstrap/createJobHunter';
import {
  HuntScheduler,
  parseSchedule,
} from './infrastructure/scheduling/huntScheduler';

async function runOnce(): Promise<void> {
  const hunter = createJobHunterFromEnv();
  try {
    await hunter.run();
  } catch (error) {
    console.error('Erro fatal no Job Hunter:', error);
    await hunter.shutdown();
    process.exitCode = 1;
  }
}

async function runScheduled(): Promise<void> {
  const scheduler = new HuntScheduler({
    schedule: parseSchedule(process.env.SCHEDULE || '09:00 14:00 18:00'),
    runOnStart: (process.env.RUN_ON_START || 'true') === 'true',
    startupSkipWindowMin: Number(process.env.STARTUP_SKIP_WINDOW_MIN || 5),
    stateDir: process.env.STATE_DIR || './data/scheduler',
    runHunt: async () => {
      const hunter = createJobHunterFromEnv();
      await hunter.run();
    },
  });

  const shutdown = () => {
    console.log('[scheduler] encerrando...');
    scheduler.stop();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await scheduler.start();
}

async function main(): Promise<void> {
  try {
    const once =
      process.argv.includes('--once') || process.env.RUN_MODE === 'once';

    if (once) {
      await runOnce();
      return;
    }

    await runScheduled();
  } catch (error) {
    console.error('Falha ao iniciar aplicação:', error);
    process.exit(1);
  }
}

void main();
