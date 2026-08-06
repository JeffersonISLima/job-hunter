import fs from 'fs';
import path from 'path';

export interface HuntSchedulerConfig {
  schedule: string[];
  runOnStart: boolean;
  startupSkipWindowMin: number;
  stateDir: string;
  pollIntervalMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  runHunt: (reason: string) => Promise<void>;
}

export function parseSchedule(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function slotToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(':');
  return Number(hh) * 60 + Number(mm);
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatHourMinute(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function minutesUntilNextSlot(
  schedule: string[],
  nowMins: number
): number {
  let nextDelta = Number.POSITIVE_INFINITY;

  for (const slot of schedule) {
    const delta = slotToMinutes(slot) - nowMins;
    if (delta >= 0 && delta < nextDelta) {
      nextDelta = delta;
    }
  }

  return nextDelta === Number.POSITIVE_INFINITY ? 99999 : nextDelta;
}

export function markerFileName(date: Date, slot: string): string {
  return `${formatLocalDate(date)}_${slot}.done`;
}

export class HuntScheduler {
  private readonly pollIntervalMs: number;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private running = false;

  constructor(private readonly config: HuntSchedulerConfig) {
    this.pollIntervalMs = config.pollIntervalMs ?? 10_000;
    this.now = config.now ?? (() => new Date());
    this.sleep =
      config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async start(): Promise<void> {
    fs.mkdirSync(this.config.stateDir, { recursive: true });
    this.running = true;

    const now = this.now();
    console.log(`[scheduler] agora=${now.toISOString()}`);
    console.log(`[scheduler] agenda=${this.config.schedule.join(' ')}`);
    console.log(`[scheduler] RUN_ON_START=${this.config.runOnStart}`);

    this.clearUpcomingMarkers(now);

    if (this.config.runOnStart) {
      await this.handleStartup(now);
    }

    while (this.running) {
      await this.tick(this.now());
      await this.sleep(this.pollIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
  }

  async tick(now: Date): Promise<void> {
    const nowMins = slotToMinutes(formatHourMinute(now));

    for (const slot of this.config.schedule) {
      const slotMins = slotToMinutes(slot);
      const marker = this.markerPath(now, slot);

      if (nowMins < slotMins || fs.existsSync(marker)) {
        continue;
      }

      console.log(
        `[scheduler] disparando slot agendado ${slot} (agora=${formatHourMinute(now)})`
      );
      fs.writeFileSync(marker, '');
      await this.safeRunHunt(`agenda ${slot}`);
    }
  }

  private async handleStartup(now: Date): Promise<void> {
    const nextIn = minutesUntilNextSlot(
      this.config.schedule,
      slotToMinutes(formatHourMinute(now))
    );

    if (nextIn <= this.config.startupSkipWindowMin) {
      console.log(
        `[scheduler] próximo slot em ${nextIn} min — pulando startup para não perder o horário`
      );
      return;
    }

    this.markPastSlotsDone(now);
    await this.safeRunHunt('startup');
  }

  private clearUpcomingMarkers(now: Date): void {
    const nowMins = slotToMinutes(formatHourMinute(now));

    for (const slot of this.config.schedule) {
      const marker = this.markerPath(now, slot);
      if (slotToMinutes(slot) >= nowMins && fs.existsSync(marker)) {
        fs.unlinkSync(marker);
        console.log(`[scheduler] removido marker prematuro/stale: ${marker}`);
      }
    }
  }

  private markPastSlotsDone(now: Date): void {
    const nowMins = slotToMinutes(formatHourMinute(now));

    for (const slot of this.config.schedule) {
      const marker = this.markerPath(now, slot);
      if (nowMins > slotToMinutes(slot)) {
        fs.writeFileSync(marker, '');
        console.log(
          `[scheduler] slot ${slot} já tinha passado — coberto pelo startup`
        );
      } else {
        console.log(`[scheduler] slot ${slot} ainda vai rodar hoje no horário`);
      }
    }
  }

  private markerPath(date: Date, slot: string): string {
    return path.join(this.config.stateDir, markerFileName(date, slot));
  }

  private async safeRunHunt(reason: string): Promise<void> {
    console.log(
      `[scheduler] ${this.now().toISOString()} — iniciando Job Hunter (${reason})`
    );
    try {
      await this.config.runHunt(reason);
      console.log('[scheduler] execução finalizada com sucesso');
    } catch (error) {
      console.error(
        '[scheduler] execução falhou — tentará no próximo horário',
        error
      );
    }
  }
}
