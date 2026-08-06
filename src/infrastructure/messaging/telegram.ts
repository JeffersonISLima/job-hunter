import TelegramBot from 'node-telegram-bot-api';
import config from '../../config/config.json';
import type { JobListing } from '../../domain/job';
import type { ScoreResult } from '../../domain/ports/jobEvaluator';
import type {
  AlertPayload,
  IJobNotifier,
} from '../../domain/ports/jobNotifier';
import type { StoredJob } from '../../domain/ports/jobRepository';

export class TelegramNotifier implements IJobNotifier {
  private escapeMarkdown(text: string): string {
    return text.replace(/([_*`\[\]])/g, '\\$1');
  }

  private removeAccents(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  private buildWhatsAppLink(jobTitle: string, company: string): string {
    const raw = `Oportunidade ${this.removeAccents(jobTitle)} - ${this.removeAccents(company)}`;
    const encoded = encodeURIComponent(raw).replace(/%20/g, '%20');
    return `https://wa.me/${config.candidate.whatsapp}?text=${encoded}`;
  }

  private buildEmailTemplate(
    jobTitle: string,
    company: string,
    recruiterEmail: string
  ): string {
    const subject = `Candidatura – ${jobTitle} – ${config.candidate.fullName}`;
    const waLink = this.buildWhatsAppLink(jobTitle, company);

    return [
      '*Template de e-mail*',
      `Para: ${this.escapeMarkdown(recruiterEmail)}`,
      `Assunto: ${this.escapeMarkdown(subject)}`,
      '',
      'Prezado(a) Recrutador(a),',
      '',
      `Meu nome é ${config.candidate.shortName}. Tenho experiência sólida em desenvolvimento de APIs, integração de sistemas, boas práticas de arquitetura e acredito que minhas habilidades podem contribuir significativamente para os projetos da ${this.escapeMarkdown(company)}.`,
      '',
      'Segue meu currículo em anexo.',
      '',
      this.escapeMarkdown(config.candidate.fullName),
      `WhatsApp: ${waLink}`,
      `LinkedIn: ${config.candidate.linkedin}`,
      `GitHub: ${config.candidate.github}`,
    ].join('\n');
  }

  private buildLinkedInTemplate(company: string): string {
    const invite =
      `Olá, tudo bem? Sou ${config.candidate.shortName}, desenvolvedor back-end. Gostaria de me candidatar a vagas de Node.js na ${company}. Posso enviar meu currículo?`.slice(
        0,
        200
      );

    return [
      '*Contato via LinkedIn*',
      'Contato não disponível publicamente. Busque recrutador / talent acquisition / tech lead.',
      '',
      `Mensagem de convite (<=200): ${this.escapeMarkdown(invite)}`,
      '',
      'Se aceitarem o convite, sugestão de DM:',
      `"Estou bem também, obrigado por perguntar.
Segue meu currículo.
Fico à disposição para qualquer dúvida ou para agendarmos uma conversa.
Muito obrigado pelo seu tempo."`,
    ].join('\n');
  }

  private formatMessage(alert: AlertPayload): string {
    const company = alert.company || 'Empresa não identificada';
    const contactBlock = alert.recruiterEmail
      ? this.buildEmailTemplate(alert.title, company, alert.recruiterEmail)
      : this.buildLinkedInTemplate(company);

    return [
      `*Nova vaga — score ${alert.score}/10*`,
      '',
      `*Título:* ${this.escapeMarkdown(alert.title)}`,
      `*Empresa:* ${this.escapeMarkdown(company)}`,
      `*Localização:* ${this.escapeMarkdown(alert.location)}`,
      `*Salário:* ${this.escapeMarkdown(alert.salary)}`,
      `*Verificado em:* ${this.escapeMarkdown(alert.verifiedAt || 'N/A')}`,
      `*Pontos internos:* ${alert.rankingPoints}`,
      '',
      `*Resumo:*\n${this.escapeMarkdown(alert.summary)}`,
      '',
      `*Por que combina:*\n${this.escapeMarkdown(alert.reason)}`,
      '',
      `*Link:* ${alert.link}`,
      '',
      contactBlock,
    ].join('\n');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getBot(): { bot: TelegramBot; chatId: string } {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      throw new Error('TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID são obrigatórios');
    }

    return {
      bot: new TelegramBot(token, { polling: false }),
      chatId,
    };
  }

  formatBrazilHour(date = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
    return `${hour}h${minute}`;
  }

  buildNoJobsStatusMessage(date = new Date()): string {
    return `Job Hunter executado às ${this.formatBrazilHour(date)}, nenhuma oportunidade encontrada.`;
  }

  private async sendTextMessage(
    text: string,
    options: { parseMode?: 'Markdown'; disablePreview?: boolean } = {},
    maxAttempts = 3
  ): Promise<void> {
    const { bot, chatId } = this.getBot();
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await bot.sendMessage(chatId, text, {
          ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
          disable_web_page_preview: options.disablePreview ?? true,
        });
        return;
      } catch (error) {
        lastError = error;
        console.warn(
          `[telegram] Falha ao enviar (tentativa ${attempt}/${maxAttempts}):`,
          error
        );
        if (attempt < maxAttempts) {
          await this.sleep(1000 * attempt);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Falha ao enviar mensagem no Telegram');
  }

  alertFromListing(job: JobListing, result: ScoreResult): AlertPayload {
    return {
      title: job.title,
      company: job.company,
      link: job.link,
      location: result.location || job.location || 'Não informada',
      salary: result.salary || config.salary.uninformedLabel,
      summary: result.summary || job.snippet || '',
      reason: result.reason,
      score: result.score,
      rankingPoints: result.rankingPoints,
      verifiedAt: job.verifiedAt || '',
      recruiterEmail: result.recruiterEmail || job.recruiterEmail || '',
    };
  }

  alertFromStored(job: StoredJob): AlertPayload {
    return {
      title: job.title,
      company: job.company,
      link: job.link,
      location: job.location || 'Não informada',
      salary: job.salary || config.salary.uninformedLabel,
      summary: job.summary || job.snippet || '',
      reason: job.reason,
      score: job.score,
      rankingPoints: job.ranking_points,
      verifiedAt: job.verified_at || '',
      recruiterEmail: job.recruiter_email || '',
    };
  }

  async sendJobAlert(alert: AlertPayload, maxAttempts = 3): Promise<void> {
    await this.sendTextMessage(
      this.formatMessage(alert),
      { parseMode: 'Markdown', disablePreview: false },
      maxAttempts
    );
  }

  async sendNoJobsStatus(date = new Date()): Promise<void> {
    await this.sendTextMessage(this.buildNoJobsStatusMessage(date));
  }
}

export type { AlertPayload, IJobNotifier };
