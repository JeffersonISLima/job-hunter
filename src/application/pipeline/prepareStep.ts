import type { PipelineContext, PipelineStep } from './context';

export class PrepareStep implements PipelineStep {
  readonly name = 'prepare';

  async run(ctx: PipelineContext): Promise<void> {
    const reinstated = ctx.repo.reinstatePreferenceOnlyRejects();
    if (reinstated > 0) {
      console.log(
        `[hunter] Reabertas ${reinstated} vaga(s) rejeitadas só por preferência de empresa (fila Telegram)`
      );
    }

    const purged = ctx.repo.purgeRetryableRejected();
    if (purged > 0) {
      console.log(
        `[hunter] Removidas ${purged} rejeição(ões) reavaliáveis (rate-limit / near-miss)`
      );
    }
  }
}
