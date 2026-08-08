import OpenAI from 'openai';
import config from '../../config/config.json';
import type { JobListing } from '../../domain/job';
import type {
  IJobEvaluator,
  ScoreResult,
} from '../../domain/ports/jobEvaluator';

export class JobCurator implements IJobEvaluator {
  private preferFallbackModel = false;

  usedFallbackModel(): boolean {
    return this.preferFallbackModel;
  }

  private getPrimaryModel(): string {
    return process.env.OPENAI_MODEL || config.model;
  }

  private getFallbackModel(): string | undefined {
    const fallback = process.env.OPENAI_MODEL_FALLBACK?.trim();
    if (!fallback || fallback === this.getPrimaryModel()) return undefined;
    return fallback;
  }

  private getOpenAIClient(apiKey: string): OpenAI {
    const baseURL =
      process.env.OPENAI_BASE_URL ||
      (apiKey.startsWith('sk-or-') ? 'https://openrouter.ai/api/v1' : undefined);

    return new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      defaultHeaders: baseURL?.includes('openrouter.ai')
        ? {
            'HTTP-Referer': 'https://github.com/JeffersonISLima/job-hunter',
            'X-Title': 'Job Hunter',
          }
        : undefined,
    });
  }

  private isRateLimitError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const err = error as {
      status?: number;
      code?: string | number;
      message?: string;
      error?: {
        code?: number;
        message?: string;
        metadata?: { limit_source?: string };
      };
    };

    const status = err.status;
    const message = `${err.message || ''} ${err.error?.message || ''}`.toLowerCase();
    const limitSource = err.error?.metadata?.limit_source || '';

    return (
      status === 429 ||
      err.code === 429 ||
      err.error?.code === 429 ||
      message.includes('rate limit') ||
      message.includes('free-models-per-day') ||
      limitSource.includes('free_tier_daily') ||
      limitSource.includes('openrouter_free_tier')
    );
  }

  private buildSystemPrompt(): string {
    const sectors = config.prioritySectors
      .map(
        (s) =>
          `- Tier ${s.tier} (${s.name}, +${s.points}): ${s.companies.join(', ')}`
      )
      .join('\n');

    const rubric = config.scoringRubric;

    return `Você é um curador especializado em vagas de emprego para Back-end Node.js Pleno.
Avalie a vaga rigorosamente com base no perfil e regras abaixo.
Responda APENAS com JSON válido no formato pedido. Sem markdown, sem texto antes ou depois.

PERFIL DO CANDIDATO:
- Nome: ${config.candidate.fullName}
- Cargo alvo: ${config.role}
- Modalidade: ${config.modality.preferred}. Híbrido/presencial: ${config.modality.hybridOrOnsite}
- Salário: priorizar R$${config.salary.priorityFrom}+; aceitar a partir de R$${config.salary.acceptFrom}; se não informado use "${config.salary.uninformedLabel}"

SETORES / EMPRESAS NA LISTA (APENAS PREFERÊNCIA — bônus de score):
${sectors}
REGRA ABSOLUTA: empresa FORA dessa lista NÃO pode, por si só, reduzir o score abaixo de 7 nem marcar compatible=false.
A lista só sobe o score (8-10). O que decide elegibilidade é o perfil (cargo Node.js pleno/mid, remoto ou BR, sem exclusões duras).

TECNOLOGIAS DESEJADAS (bônus de overlap; Node.js como stack central já basta para elegível):
${config.desiredTech.join(', ')}

EXCLUSÕES (incompatível só se a stack PRINCIPAL for estas, não Node.js):
${config.exclusions.join(', ')}
Node.js deve ser a tecnologia central.

REGRAS OBRIGATÓRIAS:
${config.hardRules.map((r) => `- ${r}`).join('\n')}

IMPORTANTE — CALIBRAÇÃO:
- Vaga real de Backend/Node.js Pleno (ou mid) no Brasil ou 100% remoto aceitando BR, sem exclusões duras → compatible=true e score >= 7 OBRIGATORIAMENTE.
- NUNCA baixe o score por "empresa não está nos tiers/setores prioritários".
- Falta de NestJS, Docker, PostgreSQL ou salário informado NÃO derruba abaixo de 7 se Node.js + nível + modalidade encaixam.
- Só use score < 7 ou compatible=false para: página agregadora, vaga inativa, stack principal excluída, inglês fluente obrigatório, presencial sem ser big tech/banco BR, ou nível claramente senior/staff acima do perfil.

RUBRICA INTERNA DE PONTOS (some mentalmente; depois normalize score 0-10):
- Empresa Tier S: +${rubric.tierS}
- Empresa Tier A: +${rubric.tierA}
- Empresa Tier B: +${rubric.tierB}
- Remoto: +${rubric.remote}
- Node.js explícito: +${rubric.nodejsExplicit}
- TypeScript: +${rubric.typescript}
- NestJS: +${rubric.nestjs}
- Docker: +${rubric.docker}
- PostgreSQL: +${rubric.postgresql}
- Microsserviços: +${rubric.microservices}
- Salário > R$10 mil: +${rubric.salaryAbove10k}

NORMALIZAÇÃO DO SCORE (0-10):
- Fit forte (tier preferencial + stack): 8-10
- Fit elegível (Node pleno remoto/BR compatível com o perfil): 7-7.9 — PISO OBRIGATÓRIO
- Parcial/duvidoso de verdade (não por falta de tier): 4-6.9
- Incompatível: compatible=false e score <= 3

JSON DE SAÍDA OBRIGATÓRIO:
{
  "compatible": boolean,
  "score": number,
  "reason": string,
  "location": string,
  "salary": string,
  "summary": string,
  "recruiterEmail": string,
  "rankingPoints": number
}

- summary: 2-3 linhas com responsabilidades e stack
- salary: valor ou "${config.salary.uninformedLabel}"
- recruiterEmail: e-mail se existir no texto; senão string vazia
- reason: justificativa curta do score`;
  }

  private clampScore(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
  }

  private extractJson(content: string): string {
    const trimmed = content.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return fenced[1].trim();
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return trimmed.slice(start, end + 1);
    }

    return trimmed;
  }

  private fallbackResult(reason: string, evaluationFailed = true): ScoreResult {
    return {
      compatible: false,
      score: 0,
      reason,
      location: '',
      salary: config.salary.uninformedLabel,
      summary: '',
      recruiterEmail: '',
      rankingPoints: 0,
      evaluationFailed,
    };
  }

  private async requestCompletion(
    openai: OpenAI,
    model: string,
    userContent: string,
    useJsonFormat: boolean
  ) {
    return openai.chat.completions.create({
      model,
      temperature: 0.2,
      ...(useJsonFormat
        ? { response_format: { type: 'json_object' as const } }
        : {}),
      messages: [
        { role: 'system', content: this.buildSystemPrompt() },
        { role: 'user', content: userContent },
      ],
    });
  }

  private async requestWithFormatFallback(
    openai: OpenAI,
    model: string,
    userContent: string
  ) {
    try {
      return await this.requestCompletion(openai, model, userContent, true);
    } catch (formatError) {
      if (this.isRateLimitError(formatError)) {
        throw formatError;
      }
      const msg =
        formatError instanceof Error
          ? formatError.message
          : String(formatError);
      if (/rate limit|429|free-models-per-day/i.test(msg)) {
        throw formatError;
      }
      console.warn(
        `[curator] response_format não suportado por ${model}; tentando sem formato forçado`
      );
      return this.requestCompletion(openai, model, userContent, false);
    }
  }

  private parseScoreResult(content: string, job: JobListing): ScoreResult {
    const parsed = JSON.parse(this.extractJson(content)) as Partial<ScoreResult>;
    const score = this.clampScore(parsed.score);
    const compatible = Boolean(parsed.compatible);

    return {
      compatible,
      score,
      reason: String(parsed.reason || 'Sem justificativa'),
      location: String(parsed.location || job.location || 'Não informada'),
      salary: String(parsed.salary || config.salary.uninformedLabel),
      summary: String(parsed.summary || job.snippet || ''),
      recruiterEmail: String(parsed.recruiterEmail || job.recruiterEmail || ''),
      rankingPoints: Number.isFinite(Number(parsed.rankingPoints))
        ? Number(parsed.rankingPoints)
        : 0,
    };
  }

  async evaluate(job: JobListing): Promise<ScoreResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return this.fallbackResult('OPENAI_API_KEY não configurada');
    }

    const openai = this.getOpenAIClient(apiKey);
    const primaryModel = this.getPrimaryModel();
    const fallbackModel = this.getFallbackModel();

    const userContent = `
Título: ${job.title}
Empresa: ${job.company}
Link: ${job.link}
Snippet: ${job.snippet}
Localização (se houver): ${job.location || 'não informada'}
Salário (se houver): ${job.salary || 'não informado'}
E-mail detectado: ${job.recruiterEmail || 'nenhum'}
Data de verificação: ${job.verifiedAt || 'não registrada'}

Texto da vaga:
${job.description || job.snippet || '(sem descrição)'}

Responda somente com o JSON solicitado.
`.trim();

    const modelsToTry =
      this.preferFallbackModel && fallbackModel
        ? [fallbackModel]
        : fallbackModel
          ? [primaryModel, fallbackModel]
          : [primaryModel];

    let lastError: unknown;

    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];
      const isFallbackAttempt = Boolean(
        fallbackModel && model === fallbackModel
      );

      try {
        if (isFallbackAttempt && !this.preferFallbackModel) {
          console.warn(
            `[curator] Rate limit no modelo principal (${primaryModel}). Usando fallback: ${fallbackModel}`
          );
          this.preferFallbackModel = true;
        } else if (this.preferFallbackModel && isFallbackAttempt) {
          console.log(`[curator] Avaliando com fallback: ${model}`);
        }

        const response = await this.requestWithFormatFallback(
          openai,
          model,
          userContent
        );
        const content = response.choices[0]?.message?.content;
        if (!content) {
          return this.fallbackResult('Resposta vazia do modelo');
        }
        return this.parseScoreResult(content, job);
      } catch (error) {
        lastError = error;

        if (
          this.isRateLimitError(error) &&
          fallbackModel &&
          model === primaryModel
        ) {
          this.preferFallbackModel = true;
          console.warn(
            `[curator] Rate limit diário em ${primaryModel}. Alternando para ${fallbackModel}`
          );
          continue;
        }

        console.error(`[curator] Erro ao avaliar com ${model}:`, error);
        break;
      }
    }

    return this.fallbackResult(
      lastError instanceof Error
        ? lastError.message
        : 'Erro desconhecido na avaliação'
    );
  }
}

export type { ScoreResult, IJobEvaluator };
