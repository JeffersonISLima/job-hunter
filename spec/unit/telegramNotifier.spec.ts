import { describe, expect, it } from 'vitest';
import { TelegramNotifier } from '../../src/infrastructure/messaging/telegram';
import { createJob, createScoreResult, createStoredJob } from '../helpers/factories';

describe('TelegramNotifier', () => {
  const notifier = new TelegramNotifier();

  it('formata hora no fuso America/Sao_Paulo', () => {
    const fixed = new Date('2026-08-03T12:00:00.000Z');
    expect(notifier.formatBrazilHour(fixed)).toBe('09h00');
  });

  it('monta mensagem de status sem vagas', () => {
    const fixed = new Date('2026-08-03T12:00:00.000Z');
    expect(notifier.buildNoJobsStatusMessage(fixed)).toBe(
      'Job Hunter executado às 09h00, nenhuma oportunidade encontrada.'
    );
  });

  it('monta aviso de fallback LLM', () => {
    expect(
      notifier.buildLlmFallbackNoticeMessage(
        'nvidia/nemotron-3-super-120b-a12b:free',
        'openai/gpt-4o-mini'
      )
    ).toContain('Usando fallback: openai/gpt-4o-mini');
  });

  it('mapeia stored job para alert payload', () => {
    const stored = createStoredJob({
      title: 'NestJS Pleno',
      ranking_points: 55,
      recruiter_email: 'rh@acme.com',
    });

    expect(notifier.alertFromStored(stored)).toEqual(
      expect.objectContaining({
        title: 'NestJS Pleno',
        rankingPoints: 55,
        recruiterEmail: 'rh@acme.com',
        link: stored.link,
      })
    );
  });

  it('mapeia listing + score para alert payload', () => {
    const job = createJob({ verifiedAt: '04/08/2026' });
    const result = createScoreResult({ score: 9, location: 'São Paulo' });

    expect(notifier.alertFromListing(job, result)).toEqual(
      expect.objectContaining({
        title: job.title,
        score: 9,
        location: 'São Paulo',
        verifiedAt: '04/08/2026',
      })
    );
  });
});
