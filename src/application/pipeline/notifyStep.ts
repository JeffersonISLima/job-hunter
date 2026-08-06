import type { IJobNotifier } from '../../domain/ports/jobNotifier';
import type { PipelineContext, PipelineStep } from './context';

export class NotifyStep implements PipelineStep {
  readonly name = 'notify';

  constructor(private readonly notifier: IJobNotifier) {}

  async run(ctx: PipelineContext): Promise<void> {
    const pending = ctx.repo.getPending(ctx.maxValid);
    console.log(
      `[queue] ${pending.length} vaga(s) na fila de envio (máx ${ctx.maxValid})`
    );

    for (const stored of pending) {
      const alert = this.notifier.alertFromStored(stored);
      try {
        await this.notifier.sendJobAlert(alert);
        ctx.repo.markSent(stored.link);
        ctx.sent += 1;
        console.log(`[sent] ${stored.title}`);
      } catch (error) {
        ctx.failedSend += 1;
        console.error(`[telegram] Permanecerá pending: ${stored.link}`, error);
      }
    }

    if (ctx.sent === 0) {
      try {
        await this.notifier.sendNoJobsStatus();
        console.log('[telegram] Status enviado: nenhuma oportunidade encontrada');
      } catch (error) {
        console.error('[telegram] Falha ao enviar status de execução vazia:', error);
      }
    }
  }
}
