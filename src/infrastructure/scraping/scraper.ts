import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import type { JobListing } from '../../domain/job';
import type { IJobScraper, JobSpyOptions } from '../../domain/ports/jobScraper';
import {
  canonicalizeJobLink,
  isClosedJobText,
  jobTextBlob,
} from './jobValidation';

const SCRAPER_VERSION = 'ddg-bing-html-v1';

function isLikelyJobPosting(link: string, title: string): boolean {
  const url = link.toLowerCase();
  const t = title.toLowerCase();

  const denyHosts = [
    'nestjs.com',
    'nodeflair.com',
    'npmjs.com',
    'wikipedia.org',
    'youtube.com',
    'github.com/nestjs',
    'stackoverflow.com',
    'medium.com',
  ];
  if (denyHosts.some((host) => url.includes(host))) return false;

  if (
    /\d{1,3}([.,]\d{3})*\+?\s*.*\b(vagas|jobs)\b/i.test(t) ||
    /job board|jobs\s*\(|vagas de emprego|official.*jobboard|careers home|lista de vagas/i.test(t)
  ) {
    return false;
  }

  const roleLike = /desenvolvedor|developer|engineer|engenheiro|backend|back-end|software/i.test(
    t
  );
  const jobHost =
    /gupy\.io|greenhouse|lever\.co|ashbyhq|workable\.com|remotive|remoteok|linkedin\.com\/jobs|indeed\.|glassdoor|programathor|vagas\.com|jobs\.|careers\.|board/i.test(
      url
    );

  return roleLike || jobHost;
}

function isBrazilRelevantJob(
  job: Pick<JobListing, 'title' | 'link' | 'snippet' | 'location' | 'description' | 'company'>
): boolean {
  const blob = [
    job.title,
    job.company,
    job.location,
    job.snippet,
    job.description?.slice(0, 500),
    job.link,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const foreignDeny =
    /\b(estados unidos|united states|\busa\b|u\.s\.a|worldwide|bengaluru|bangalore|\bindia\b|europa|europe|germany|deutschland|united kingdom|\buk\b|canada|mexico city|montevideo|uruguay|argentina(?!\s*brasil)|poland|romania|philippines|vietnam|nigeria)\b/i;

  const brazilAllow =
    /\b(brasil|brazil|br-br|pt-br)\b|são paulo|sao paulo|rio de janeiro|belo horizonte|curitiba|florian[oó]polis|campinas|porto alegre|bras[ií]lia|recife|fortaleza|salvador|remoto\s*\(?\s*brasil|brazil\s*remote|gupy\.io|programathor|vagas\.com\.br|indeed\.com\.br|catho\.|infojobs\.|linkedin\.com\/jobs\/.*brazil|nubank|ifood|picpay|hotmart|mercado livre|mercado pago|stone|btg|c6 bank/;

  if (/\d{1,3}([.,]\d{3})*\+?\s*.*\b(vagas|jobs)\b/i.test(job.title)) {
    return false;
  }

  if (foreignDeny.test(blob) && !brazilAllow.test(blob)) {
    return false;
  }

  if (/remotive\.com|remoteok\.com|linkedin\.com|glassdoor\.com|indeed\.com(?!\.br)/i.test(job.link)) {
    return brazilAllow.test(blob);
  }

  if (/gupy\.io|programathor|vagas\.com\.br|indeed\.com\.br|catho\.|infojobs\./i.test(job.link)) {
    return true;
  }

  if (brazilAllow.test(blob)) return true;

  if (
    /desenvolvedor|engenheiro|vaga|pleno|j[uú]nior|s[eê]nior/i.test(job.title) &&
    !foreignDeny.test(blob)
  ) {
    return true;
  }

  return false;
}

function formatVerifiedAt(date = new Date()): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function extractEmail(text: string): string | undefined {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0];
}

export function guessCompany(title: string, snippet: string, host: string): string {
  const gupyHost = host.replace(/^www\./, '').toLowerCase();
  const gupyMatch = gupyHost.match(/^([a-z0-9-]+)\.gupy\.io$/i);
  if (gupyMatch?.[1] && !['www', 'portal', 'app'].includes(gupyMatch[1])) {
    const sub = gupyMatch[1];
    return sub.charAt(0).toUpperCase() + sub.slice(1);
  }

  const patterns = [
    /(?:^|\s)(?:na|at|@)\s+([A-ZÁÉÍÓÚÂÊÔÃÕ][\wÁÉÍÓÚÂÊÔÃÕà-ú&.\-\s]{1,40})/i,
    /-\s*([A-ZÁÉÍÓÚÂÊÔÃÕ][\wÁÉÍÓÚÂÊÔÃÕà-ú&.\-\s]{1,40})\s*$/,
  ];

  for (const pattern of patterns) {
    const fromTitle = title.match(pattern);
    if (fromTitle?.[1]) return fromTitle[1].trim();
  }

  const fromSnippet = snippet.match(/(?:empresa|company)\s*[:\-]?\s*([^\n.|]{2,40})/i);
  if (fromSnippet?.[1]) return fromSnippet[1].trim();

  const cleanedHost = host.replace(/^www\./, '').split('.')[0];
  return cleanedHost ? cleanedHost.charAt(0).toUpperCase() + cleanedHost.slice(1) : '';
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeNodeJob(text: string): boolean {
  return /node\.?js|nestjs|typescript|express|fastify/i.test(text);
}

export class JobScraper implements IJobScraper {
  private browserPromise: Promise<Browser> | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
      });
    }
    return this.browserPromise;
  }

  private async newContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    return browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      viewport: { width: 1365, height: 900 },
      extraHTTPHeaders: {
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
  }

  async close(): Promise<void> {
    if (this.browserPromise) {
      const browser = await this.browserPromise;
      await browser.close();
      this.browserPromise = null;
    }
  }

  private async dismissConsent(page: Page): Promise<void> {
    const selectors = [
      '#bnp_btn_accept',
      'button:has-text("Aceitar tudo")',
      'button:has-text("Aceitar todas")',
      'button:has-text("Accept all")',
      'button:has-text("Accept")',
      'button:has-text("I agree")',
    ];

    for (const selector of selectors) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 1500 })) {
          await button.click({ timeout: 2000 });
          await page.waitForTimeout(800);
          return;
        }
      } catch {
      }
    }
  }

  private toListings(
    raw: Array<{ title: string; link: string; snippet: string }>
  ): JobListing[] {
    const listings: JobListing[] = [];

    for (const item of raw) {
      const link = canonicalizeJobLink(item.link);
      if (!link) continue;
      try {
        const host = new URL(link).hostname;
        listings.push({
          title: item.title,
          company: guessCompany(item.title, item.snippet, host),
          link,
          snippet: item.snippet,
        });
      } catch {
      }
    }

    return listings;
  }

  private async searchDuckDuckGo(query: string): Promise<JobListing[]> {
    const context = await this.newContext();
    const page = await context.newPage();

    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(800);

      const raw = await page.evaluate(() => {
        const out: Array<{ title: string; link: string; snippet: string }> = [];
        const items = Array.from(document.querySelectorAll('.result, .web-result, .results_links'));

        for (const item of items) {
          const anchor = item.querySelector('a.result__a, a.result-link') as HTMLAnchorElement | null;
          if (!anchor?.href) continue;
          const title = anchor.textContent?.trim() || '';
          const snippet =
            item.querySelector('.result__snippet, .result-snippet')?.textContent?.trim() || '';
          if (!title) continue;
          out.push({ title, link: anchor.href, snippet });
          if (out.length >= 10) break;
        }
        return out;
      });

      const listings = this.toListings(raw);
      console.log(`[scraper] DuckDuckGo: ${listings.length} resultado(s)`);
      return listings;
    } catch (error) {
      console.error(`[scraper] Erro DuckDuckGo:`, error);
      return [];
    } finally {
      await page.close();
      await context.close();
    }
  }

  private async searchBingHtml(query: string): Promise<JobListing[]> {
    const context = await this.newContext();
    const page = await context.newPage();

    try {
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=pt-BR&cc=BR`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await this.dismissConsent(page);
      await page.waitForTimeout(1000);

      try {
        await page.waitForSelector('li.b_algo', { timeout: 8000 });
      } catch {
      }

      const raw = await page.evaluate(() => {
        const out: Array<{ title: string; link: string; snippet: string }> = [];
        const items = Array.from(document.querySelectorAll('li.b_algo'));

        for (const item of items) {
          const anchor = item.querySelector('h2 a') as HTMLAnchorElement | null;
          if (!anchor?.href) continue;
          const title = anchor.textContent?.trim() || '';
          const snippet =
            item.querySelector('.b_caption p, p')?.textContent?.trim() || '';
          if (!title) continue;
          out.push({ title, link: anchor.href, snippet });
          if (out.length >= 10) break;
        }
        return out;
      });

      if (raw.length === 0) {
        console.warn('[scraper] Bing HTML: nenhum li.b_algo (bloqueio ou página vazia)');
        return [];
      }

      const listings = this.toListings(raw);
      console.log(`[scraper] Bing HTML: ${listings.length} resultado(s)`);
      return listings;
    } catch (error) {
      console.error(`[scraper] Erro Bing HTML:`, error);
      return [];
    } finally {
      await page.close();
      await context.close();
    }
  }

  private async searchJobApis(): Promise<JobListing[]> {
    const listings: JobListing[] = [];

    try {
      console.log('[scraper] (API) Remotive search=node');
      const remotiveRes = await fetchWithTimeout(
        'https://remotive.com/api/remote-jobs?category=software-dev&search=node'
      );
      if (remotiveRes.ok) {
        const data = (await remotiveRes.json()) as {
          jobs?: Array<{
            url: string;
            title: string;
            company_name: string;
            description?: string;
            candidate_required_location?: string;
            salary?: string;
          }>;
        };

        for (const job of data.jobs || []) {
          const blob = `${job.title} ${job.description || ''}`;
          if (!looksLikeNodeJob(blob)) continue;
          const description = (job.description || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 3000);
          const link = canonicalizeJobLink(job.url);
          if (!link) continue;
          const listing: JobListing = {
            title: job.title,
            company: job.company_name,
            link,
            snippet: description.slice(0, 280),
            description,
            location: job.candidate_required_location || 'Remoto',
            salary: job.salary || '',
            verifiedAt: formatVerifiedAt(),
          };
          if (!isBrazilRelevantJob(listing)) continue;
          if (isClosedJobText(jobTextBlob([listing.title, listing.snippet, listing.description]))) {
            continue;
          }
          listings.push(listing);
        }
      } else {
        console.warn(`[scraper] Remotive HTTP ${remotiveRes.status}`);
      }
    } catch (error) {
      console.warn('[scraper] Falha Remotive:', error);
    }

    try {
      console.log('[scraper] (API) RemoteOK');
      const remoteOkRes = await fetchWithTimeout('https://remoteok.com/api', {
        headers: { 'User-Agent': 'job-hunter/1.0' },
      });
      if (remoteOkRes.ok) {
        const data = (await remoteOkRes.json()) as Array<{
          id?: string | number;
          url?: string;
          position?: string;
          company?: string;
          description?: string;
          location?: string;
          tags?: string[];
          salary_min?: number;
          salary_max?: number;
        }>;

        for (const job of data) {
          if (!job || !job.position || !job.url) continue;
          const tags = (job.tags || []).join(' ');
          const blob = `${job.position} ${tags} ${job.description || ''}`;
          if (!looksLikeNodeJob(blob)) continue;

          const description = (job.description || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 3000);

          const rawLink = job.url.startsWith('http')
            ? job.url
            : `https://remoteok.com/remote-jobs/${job.id}`;
          const link = canonicalizeJobLink(rawLink);
          if (!link) continue;
          const listing: JobListing = {
            title: job.position,
            company: job.company || 'Empresa não identificada',
            link,
            snippet: description.slice(0, 280),
            description,
            location: job.location || 'Remoto',
            salary:
              job.salary_min || job.salary_max
                ? `${job.salary_min || '?'} - ${job.salary_max || '?'}`
                : '',
            verifiedAt: formatVerifiedAt(),
          };
          if (!isBrazilRelevantJob(listing)) continue;
          if (isClosedJobText(jobTextBlob([listing.title, listing.snippet, listing.description]))) {
            continue;
          }
          listings.push(listing);
        }
      } else {
        console.warn(`[scraper] RemoteOK HTTP ${remoteOkRes.status}`);
      }
    } catch (error) {
      console.warn('[scraper] Falha RemoteOK:', error);
    }

    console.log(`[scraper] APIs: ${listings.length} vaga(s) Node/TS candidatas`);
    return listings;
  }

  async searchJobSpy(options: JobSpyOptions): Promise<JobListing[]> {
    const scriptPath = path.join(process.cwd(), 'jobspy_fetch.py');
    const sites = options.sites.join(',');
    const args = [
      scriptPath,
      '--sites',
      sites,
      '--search-term',
      options.searchTerm || 'Node.js OR NestJS backend pleno',
      '--location',
      options.location || 'Brazil',
      '--results',
      String(options.results ?? 8),
      '--google-search-term',
      options.googleSearchTerm || 'Node.js NestJS backend jobs Brazil remote',
    ];

    console.log(`[scraper] (JobSpy) sites=${sites}`);

    return new Promise((resolve) => {
      const child = spawn('python3', args, {
        cwd: process.cwd(),
        env: process.env,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        console.warn('[scraper] JobSpy não iniciado:', error);
        resolve([]);
      });

      child.on('close', (code) => {
        if (stderr.trim()) {
          console.warn('[scraper] JobSpy stderr:', stderr.trim().slice(0, 500));
        }
        if (code !== 0 && !stdout.trim()) {
          console.warn(`[scraper] JobSpy exit ${code}`);
          resolve([]);
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim() || '[]') as Array<{
            title?: string;
            company?: string;
            link?: string;
            snippet?: string;
            description?: string;
            location?: string;
            salary?: string;
          }>;

          const listings: JobListing[] = [];
          for (const item of parsed) {
            if (!item.link || !item.title) continue;
            const link = canonicalizeJobLink(item.link);
            if (!link) continue;
            if (!isLikelyJobPosting(link, item.title)) continue;
            const description = (item.description || item.snippet || '').slice(0, 3000);
            const listing: JobListing = {
              title: item.title,
              company: item.company || '',
              link,
              snippet: item.snippet || description.slice(0, 280),
              description,
              location: item.location || 'Brazil',
              salary: item.salary || '',
              verifiedAt: formatVerifiedAt(),
            };
            if (!isBrazilRelevantJob(listing)) continue;
            if (isClosedJobText(jobTextBlob([listing.title, listing.snippet, listing.description]))) {
              continue;
            }
            listings.push(listing);
          }

          console.log(`[scraper] JobSpy: ${listings.length} vaga(s) (${sites})`);
          resolve(listings);
        } catch (error) {
          console.warn('[scraper] JobSpy JSON inválido:', error);
          resolve([]);
        }
      });
    });
  }

  private async fetchJobDetails(job: JobListing): Promise<JobListing> {
    if (job.description && job.description.length > 200 && job.verifiedAt) {
      return job;
    }

    const context = await this.newContext();
    let page: Page | null = null;

    try {
      page = await context.newPage();
      await page.goto(job.link, { waitUntil: 'domcontentloaded', timeout: 45000 });

      const details = await page.evaluate(() => {
        const titleEl =
          document.querySelector('h1') ||
          document.querySelector('h2') ||
          document.querySelector('[data-testid="job-title"]');
        const title = titleEl?.textContent?.trim() || '';
        const bodyText = (document.body?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 3000);
        return { title, bodyText };
      });

      const description = details.bodyText || job.snippet || '';
      const recruiterEmail = extractEmail(description);
      const title = details.title || job.title;

      return {
        ...job,
        title,
        description,
        recruiterEmail: recruiterEmail || job.recruiterEmail,
        company: job.company || guessCompany(title, description, new URL(job.link).hostname),
        verifiedAt: formatVerifiedAt(),
      };
    } catch (error) {
      console.warn(`[scraper] Falha ao abrir detalhes de ${job.link}:`, error);
      return {
        ...job,
        description: job.description || job.snippet || '',
        verifiedAt: job.verifiedAt || formatVerifiedAt(),
      };
    } finally {
      if (page) await page.close();
      await context.close();
    }
  }

  private async addListings(
    listings: JobListing[],
    byLink: Map<string, JobListing>,
    minJobs: number,
    enrich: boolean
  ): Promise<void> {
    for (const listing of listings) {
      if (byLink.size >= minJobs) return;

      const link = canonicalizeJobLink(listing.link);
      if (!link) continue;
      const normalized = { ...listing, link };

      if (byLink.has(normalized.link)) continue;
      if (!isLikelyJobPosting(normalized.link, normalized.title)) {
        console.log(`[scraper] ignorado (não parece vaga): ${normalized.title}`);
        continue;
      }
      if (!isBrazilRelevantJob(normalized)) {
        console.log(`[scraper] ignorado (fora do Brasil): ${normalized.title}`);
        continue;
      }

      const detailed = enrich
        ? await this.fetchJobDetails(normalized)
        : {
            ...normalized,
            verifiedAt: normalized.verifiedAt || formatVerifiedAt(),
          };

      if (
        isClosedJobText(
          jobTextBlob([detailed.title, detailed.snippet, detailed.description])
        )
      ) {
        console.log(`[scraper] ignorado (encerrada): ${detailed.title}`);
        continue;
      }

      byLink.set(detailed.link, detailed);
      console.log(`[scraper] +1 (${byLink.size}/${minJobs}) ${detailed.title}`);
    }
  }

  private buildExpansionQueries(round: number): string[] {
    const bases = [
      'vaga Node.js pleno remoto Brasil',
      'vaga NestJS TypeScript backend pleno Brasil',
      'desenvolvedor Node.js pleno remoto Brazil',
      'Node.js NestJS backend pleno site:gupy.io',
      'Node.js backend site:programathor.com.br',
      'Node.js backend site:vagas.com.br',
      'Node.js backend site:indeed.com.br',
      'Node.js NestJS Brasil site:boards.greenhouse.io',
      'Node.js Brasil site:jobs.lever.co',
      'site:linkedin.com/jobs Node.js NestJS backend pleno Brasil',
      'desenvolvedor node remoto gupy Brasil',
      'vaga back-end Node TypeScript remoto Brasil',
    ];

    const companies = [
      'Nubank',
      'iFood',
      'Stone',
      'PicPay',
      'Hotmart',
      'Pipefy',
      'Inter',
      'BTG',
      'Mercado Livre',
      'Dock',
    ];

    const companyQueries = companies.map(
      (c) => `"${c}" (Node.js OR NestJS) (vaga OR job OR carreira OR careers)`
    );

    const offset = (round * 4) % bases.length;
    return [...bases.slice(offset), ...bases.slice(0, offset), ...companyQueries].slice(0, 8);
  }

  private logSearchProviders(): void {
    console.log(
      '[scraper] Busca web: DuckDuckGo (principal); Bing HTML só em queries DDG vazias se pool < minJobs'
    );
  }

  async gatherJobs(
    queries: string[],
    fallbackQueries: string[] = [],
    minJobs = 5
  ): Promise<JobListing[]> {
    const targetPool = Math.max(minJobs * 4, 20);
    console.log(
      `[scraper] versão=${SCRAPER_VERSION} | meta mínima=${minJobs} | pool alvo=${targetPool}`
    );
    this.logSearchProviders();
    const byLink = new Map<string, JobListing>();

    const runDdgBatch = async (
      batch: string[],
      label: string,
      stopAt: number
    ): Promise<string[]> => {
      const emptyQueries: string[] = [];
      for (const query of batch) {
        if (byLink.size >= stopAt) return emptyQueries;
        console.log(`[scraper] (${label}/ddg) ${byLink.size}/${stopAt} | ${query}`);
        const listings = await this.searchDuckDuckGo(query);
        if (listings.length === 0) emptyQueries.push(query);
        await this.addListings(listings, byLink, stopAt, true);
      }
      return emptyQueries;
    };

    const runBingForEmptyQueries = async (
      emptyQueries: string[],
      label: string
    ) => {
      if (byLink.size >= minJobs || emptyQueries.length === 0) return;
      console.log(
        `[scraper] Pool ${byLink.size}/${minJobs} — Bing HTML em ${emptyQueries.length} query(s) vazias do DDG (${label})`
      );
      for (const query of emptyQueries) {
        if (byLink.size >= minJobs) return;
        console.log(
          `[scraper] (${label}/bing) ${byLink.size}/${minJobs} | ${query}`
        );
        const listings = await this.searchBingHtml(query);
        await this.addListings(listings, byLink, targetPool, true);
      }
    };

    const emptyPriority = await runDdgBatch(queries, 'prioritário', targetPool);
    await runBingForEmptyQueries(emptyPriority, 'prioritário');

    if (byLink.size < targetPool && fallbackQueries.length > 0) {
      console.log(`[scraper] Pool ${byLink.size}/${targetPool}. Buscas amplas (DDG)...`);
      const emptyAmpla = await runDdgBatch(fallbackQueries, 'ampla', targetPool);
      await runBingForEmptyQueries(emptyAmpla, 'ampla');
    }

    if (byLink.size < targetPool) {
      console.log('[scraper] Completando pool com APIs de vagas (Remotive/RemoteOK)...');
      await this.addListings(await this.searchJobApis(), byLink, targetPool, false);
    }

    let round = 0;
    while (byLink.size < minJobs && round < 3) {
      round += 1;
      console.log(
        `[scraper] Ainda abaixo da meta (${byLink.size}/${minJobs}). Expansão round ${round}...`
      );
      const expansion = this.buildExpansionQueries(round);
      const emptyExpansion = await runDdgBatch(
        expansion,
        `expansão-${round}`,
        targetPool
      );
      await runBingForEmptyQueries(emptyExpansion, `expansão-${round}`);
      if (byLink.size < minJobs) {
        await this.addListings(await this.searchJobApis(), byLink, targetPool, false);
      }
    }

    const jobs = Array.from(byLink.values());
    if (jobs.length < minJobs) {
      console.warn(
        `[scraper] Encerrado com ${jobs.length}/${minJobs} vagas após esgotar fontes principais.`
      );
    } else {
      console.log(`[scraper] Pool pronto: ${jobs.length} vagas únicas para curadoria`);
    }

    return jobs;
  }
}
