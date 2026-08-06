import type { PipelineContext, PipelineStep } from './context';

export class HunterPipeline {
  constructor(private readonly steps: PipelineStep[]) {}

  async run(ctx: PipelineContext): Promise<void> {
    for (const step of this.steps) {
      console.log(`[pipeline] step=${step.name}`);
      await step.run(ctx);
    }
  }
}
