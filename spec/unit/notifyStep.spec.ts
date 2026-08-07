import { describe, expect, it, vi } from 'vitest';
import { NotifyStep } from '../../src/application/pipeline/notifyStep';
import {
  createContext,
  createMockNotifier,
  createMockRepository,
  createStoredJob,
} from '../helpers/factories';

describe('NotifyStep', () => {
  it('envia pending, marca como sent e incrementa sent', async () => {
    const pending = [createStoredJob()];
    const repo = createMockRepository({
      getPending: vi.fn().mockReturnValue(pending),
    });
    const notifier = createMockNotifier();
    const step = new NotifyStep(notifier);
    const ctx = createContext({ repo, maxValid: 3 });

    await step.run(ctx);

    expect(notifier.sendJobAlert).toHaveBeenCalledOnce();
    expect(repo.markSent).toHaveBeenCalledWith(pending[0].link);
    expect(ctx.sent).toBe(1);
    expect(notifier.sendNoJobsStatus).not.toHaveBeenCalled();
  });

  it('mantém pending e conta falha quando o envio quebra', async () => {
    const pending = [createStoredJob()];
    const repo = createMockRepository({
      getPending: vi.fn().mockReturnValue(pending),
    });
    const notifier = createMockNotifier({
      sendJobAlert: vi.fn().mockRejectedValue(new Error('telegram down')),
    });
    const step = new NotifyStep(notifier);
    const ctx = createContext({ repo });

    await step.run(ctx);

    expect(repo.markSent).not.toHaveBeenCalled();
    expect(ctx.failedSend).toBe(1);
    expect(ctx.sent).toBe(0);
    expect(notifier.sendNoJobsStatus).toHaveBeenCalledOnce();
  });

  it('envia status vazio quando nenhuma vaga foi enviada', async () => {
    const repo = createMockRepository({
      getPending: vi.fn().mockReturnValue([]),
    });
    const notifier = createMockNotifier();
    const step = new NotifyStep(notifier);
    const ctx = createContext({ repo });

    await step.run(ctx);

    expect(notifier.sendJobAlert).not.toHaveBeenCalled();
    expect(notifier.sendNoJobsStatus).toHaveBeenCalledOnce();
  });

  it('não envia vaga encerrada e marca como rejected', async () => {
    const pending = [
      createStoredJob({
        link: 'https://montreal.gupy.io/jobs/11575472',
        title: 'Desenvolvedor Node Pleno',
        description: 'Candidaturas encerradas. Inscrições encerradas.',
      }),
    ];
    const repo = createMockRepository({
      getPending: vi.fn().mockReturnValue(pending),
    });
    const notifier = createMockNotifier();
    const step = new NotifyStep(notifier);
    const ctx = createContext({ repo });

    await step.run(ctx);

    expect(notifier.sendJobAlert).not.toHaveBeenCalled();
    expect(repo.markSent).not.toHaveBeenCalled();
    expect(repo.markRejected).toHaveBeenCalledWith(
      pending[0].link,
      'Vaga encerrada / candidaturas fechadas'
    );
    expect(ctx.sent).toBe(0);
    expect(notifier.sendNoJobsStatus).toHaveBeenCalledOnce();
  });
});
