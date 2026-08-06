import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HuntScheduler,
  minutesUntilNextSlot,
  parseSchedule,
  slotToMinutes,
} from '../../src/infrastructure/scheduling/huntScheduler';

describe('huntScheduler helpers', () => {
  it('parseia agenda por espaços', () => {
    expect(parseSchedule('09:00 14:00 18:00')).toEqual([
      '09:00',
      '14:00',
      '18:00',
    ]);
  });

  it('converte horário em minutos', () => {
    expect(slotToMinutes('09:00')).toBe(540);
    expect(slotToMinutes('14:30')).toBe(870);
  });

  it('calcula minutos até o próximo slot', () => {
    expect(minutesUntilNextSlot(['09:00', '14:00', '18:00'], 500)).toBe(40);
    expect(minutesUntilNextSlot(['09:00', '14:00'], 900)).toBe(99999);
  });
});

describe('HuntScheduler', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempStateDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-hunter-sched-'));
    dirs.push(dir);
    return dir;
  }

  it('dispara slot uma vez e respeita marker', async () => {
    const stateDir = tempStateDir();
    const runHunt = vi.fn().mockResolvedValue(undefined);
    const scheduler = new HuntScheduler({
      schedule: ['09:00'],
      runOnStart: false,
      startupSkipWindowMin: 5,
      stateDir,
      pollIntervalMs: 5,
      now: () => new Date(2026, 7, 4, 9, 1, 0),
      sleep: async () => {
        scheduler.stop();
      },
      runHunt,
    });

    await scheduler.start();

    expect(runHunt).toHaveBeenCalledTimes(1);
    expect(runHunt).toHaveBeenCalledWith('agenda 09:00');
    expect(fs.existsSync(path.join(stateDir, '2026-08-04_09:00.done'))).toBe(
      true
    );
  });

  it('pula startup quando o próximo slot está na janela', async () => {
    const stateDir = tempStateDir();
    const runHunt = vi.fn().mockResolvedValue(undefined);
    const scheduler = new HuntScheduler({
      schedule: ['09:00'],
      runOnStart: true,
      startupSkipWindowMin: 5,
      stateDir,
      pollIntervalMs: 5,
      now: () => new Date(2026, 7, 4, 8, 57, 0),
      sleep: async () => {
        scheduler.stop();
      },
      runHunt,
    });

    await scheduler.start();

    expect(runHunt).not.toHaveBeenCalled();
  });

  it('roda startup e marca slots passados', async () => {
    const stateDir = tempStateDir();
    const runHunt = vi.fn().mockResolvedValue(undefined);
    const scheduler = new HuntScheduler({
      schedule: ['09:00', '14:00'],
      runOnStart: true,
      startupSkipWindowMin: 5,
      stateDir,
      pollIntervalMs: 5,
      now: () => new Date(2026, 7, 4, 10, 0, 0),
      sleep: async () => {
        scheduler.stop();
      },
      runHunt,
    });

    await scheduler.start();

    expect(runHunt).toHaveBeenCalledWith('startup');
    expect(fs.existsSync(path.join(stateDir, '2026-08-04_09:00.done'))).toBe(
      true
    );
    expect(fs.existsSync(path.join(stateDir, '2026-08-04_14:00.done'))).toBe(
      false
    );
  });
});
