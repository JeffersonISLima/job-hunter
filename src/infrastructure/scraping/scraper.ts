import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn } from 'child_process';
import path from 'path';
import type { JobListing } from '../../domain/job';
import type { IJobScraper, JobSpyOptions } from '../../domain/ports/jobScraper';

const SCRAPER_VERSION = 'gather-brazil-only-v1';

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

function normalizeLink(href: string): string | null {
  try {
    if (!href) return null;
    if (href.startsWith('/url?') || (href.includes('google.') && href.includes('/url?'))) {
      const url = new URL(href, 'https://www.google.com');
      const q = url.searchParams.get('q') || url.searchParams.get('url');
      if (q) return normalizeLink(q);
    }
    if (href.startsWith('/l/?') || href.includes('duckduckgo.com/l/')) {
      const url = new URL(href, 'https://duckduckgo.com');
      const uddg = url.searchParams.get('uddg');
      if (uddg) return normalizeLink(uddg);
    }
    const url = new URL(href);
    if (
      url.hostname.includes('google.') ||
      url.hostname.includes('duckduckgo.com') ||
      url.hostname.includes('bing.com')
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function extractEmail(text: string): string | undefined {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0];
}

function guessCompany(title: string, snippet: string, host: string): string {
  const patterns = [
    /(?:na|at|@)\s+([A-ZÁÉÍÓÚÂÊÔÃÕ][\wÁÉÍÓÚÂÊÔÃÕà-ú&.\-\s]{1,40})/i,
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
      'button:has-text("Aceitar tudo")',
      'button:has-text("Aceitar todas")',
      'button:has-text("Aceitar")',
      'button:has-text("Accept all")',
      'button:has-text("I agree")',
      '#L2AGLb',
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

  private async pageLooksBlocked(page: Page): Promise<string | null> {
    const content = (await page.content()).toLowerCase();
    const title = (await page.title()).toLowerCase();

    if (
      content.includes('unusual traffic') ||
      content.includes('captcha') ||
      content.includes('recaptcha') ||
      content.includes('/sorry/') ||
      title.includes('before you continue') ||
      title.includes('sorry')
    ) {
      return 'possível CAPTCHA/bloqueio anti-bot';
    }
    return null;
  }

  private async extractGoogleResults(
    page: Page
  ): Promise<Array<{ title: string; link: string; snippet: string }>> {
    return page.evaluate(() => {
      const out: Array<{ title: string; link: string; snippet: string }> = [];
      const seen = new Set<string>();
      const anchors = Array.from(
        document.querySelectorAll('div.g a, div[data-sokoban-container] a, a[jsname]')
      );

      for (const a of anchors) {
        const href = (a as HTMLAnchorElement).href || '';
        if (!href.startsWith('http') || href.includes('google.')) continue;

        const h3 = a.querySelector('h3');
        const title = h3?.textContent?.trim() || a.textContent?.trim() || '';
        if (!title || title.length < 5 || seen.has(href)) continue;
        seen.add(href);

        const container =
          a.closest('div.g') ||
          a.closest('div[data-sokoban-container]') ||
          a.parentElement?.parentElement;
        const snippet =
          container?.querySelector('div[data-sncf], div.VwiC3b, span.aCOpRe')?.textContent?.trim() ||
          '';

        out.push({ title, link: href, snippet });
        if (out.length >= 10) break;
      }

      return out;
    });
  }

  private toListings(
    raw: Array<{ title: string; link: string; snippet: string }>
  ): JobListing[] {
    const listings: JobListing[] = [];

    for (const item of raw) {
      const link = normalizeLink(item.link);
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

  private async searchGoogle(query: string): Promise<JobListing[]> {
    const context = await this.newContext();
    const page = await context.newPage();

    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=br&num=10&pws=0`;
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await this.dismissConsent(page);
      await page.waitForTimeout(1200);

      const blocked = await this.pageLooksBlocked(page);
      if (blocked) {
        console.warn(`[scraper] Google bloqueado (${blocked})`);
        return [];
      }

      try {
        await page.waitForSelector('div.g, h3, #search', { timeout: 8000 });
      } catch {
      }

      const listings = this.toListings(await this.extractGoogleResults(page));
      console.log(`[scraper] Google: ${listings.length} resultado(s)`);
      return listings;
    } catch (error) {
      console.error(`[scraper] Erro Google:`, error);
      return [];
    } finally {
      await page.close();
      await context.close();
    }
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

  private async searchBingWeb(query: string): Promise<JobListing[]> {
    const apiKey = process.env.BING_SEARCH_API_KEY;
    if (!apiKey) return [];

    try {
      console.log('[scraper] Tentando Bing Web Search API...');
      const url = new URL('https://api.bing.microsoft.com/v7.0/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', '10');
      url.searchParams.set('mkt', 'pt-BR');

      const res = await fetch(url, {
        headers: { 'Ocp-Apim-Subscription-Key': apiKey },
      });

      if (!res.ok) {
        const body = await res.text();
        console.warn(
          `[scraper] Bing HTTP ${res.status} (API aposentada em ago/2025): ${body.slice(0, 200)}`
        );
        return [];
      }

      const data = (await res.json()) as {
        webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> };
      };

      const listings = this.toListings(
        (data.webPages?.value || [])
          .filter((item) => item.name && item.url)
          .map((item) => ({
            title: item.name || '',
            link: item.url || '',
            snippet: item.snippet || '',
          }))
      );
      console.log(`[scraper] Bing: ${listings.length} resultado(s)`);
      return listings;
    } catch (error) {
      console.warn('[scraper] Falha Bing:', error);
      return [];
    }
  }

  private async searchSerpApi(query: string): Promise<JobListing[]> {
    const apiKey = process.env.SERPAPI_API_KEY;
    if (!apiKey) return [];

    try {
      console.log('[scraper] Tentando SerpAPI...');
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', query);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('hl', 'pt');
      url.searchParams.set('gl', 'br');
      url.searchParams.set('num', '10');

      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[scraper] SerpAPI HTTP ${res.status}: ${await res.text()}`);
        return [];
      }

      const data = (await res.json()) as {
        organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
      };

      const listings = this.toListings(
        (data.organic_results || [])
          .filter((item) => item.title && item.link)
          .map((item) => ({
            title: item.title || '',
            link: item.link || '',
            snippet: item.snippet || '',
          }))
      );
      console.log(`[scraper] SerpAPI: ${listings.length} resultado(s)`);
      return listings;
    } catch (error) {
      console.warn('[scraper] Falha SerpAPI:', error);
      return [];
    }
  }

  private async searchSearchApi(query: string): Promise<JobListing[]> {
    const apiKey = process.env.SEARCHAPI_API_KEY;
    if (!apiKey) return [];

    try {
      console.log('[scraper] Tentando SearchAPI...');
      const url = new URL('https://www.searchapi.io/api/v1/search');
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', query);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('hl', 'pt');
      url.searchParams.set('gl', 'br');
      url.searchParams.set('num', '10');

      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[scraper] SearchAPI HTTP ${res.status}: ${await res.text()}`);
        return [];
      }

      const data = (await res.json()) as {
        organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
      };

      const listings = this.toListings(
        (data.organic_results || [])
          .filter((item) => item.title && item.link)
          .map((item) => ({
            title: item.title || '',
            link: item.link || '',
            snippet: item.snippet || '',
          }))
      );
      console.log(`[scraper] SearchAPI: ${listings.length} resultado(s)`);
      return listings;
    } catch (error) {
      console.warn('[scraper] Falha SearchAPI:', error);
      return [];
    }
  }

  private async searchQuery(query: string): Promise<JobListing[]> {
    const fromGoogle = await this.searchGoogle(query);
    if (fromGoogle.length > 0) return fromGoogle;

    console.log('[scraper] Fallback DuckDuckGo');
    const fromDdg = await this.searchDuckDuckGo(query);
    if (fromDdg.length > 0) return fromDdg;

    const apiFallbacks: Array<[string, boolean, () => Promise<JobListing[]>]> = [
      ['Bing', Boolean(process.env.BING_SEARCH_API_KEY), () => this.searchBingWeb(query)],
      ['SerpAPI', Boolean(process.env.SERPAPI_API_KEY), () => this.searchSerpApi(query)],
      ['SearchAPI', Boolean(process.env.SEARCHAPI_API_KEY), () => this.searchSearchApi(query)],
    ];

    for (const [name, enabled, fn] of apiFallbacks) {
      if (!enabled) continue;
      console.log(`[scraper] Fallback ${name}`);
      const results = await fn();
      if (results.length > 0) return results;
    }

    return [];
  }

  private async searchJobApis(): Promise<JobListing[]> {
    const listings: JobListing[] = [];

    try {
      console.log('[scraper] (API) Remotive search=node');
      const remotiveRes = await fetch(
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
          const listing: JobListing = {
            title: job.title,
            company: job.company_name,
            link: job.url,
            snippet: description.slice(0, 280),
            description,
            location: job.candidate_required_location || 'Remoto',
            salary: job.salary || '',
            verifiedAt: formatVerifiedAt(),
          };
          if (!isBrazilRelevantJob(listing)) continue;
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
      const remoteOkRes = await fetch('https://remoteok.com/api', {
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

          const listing: JobListing = {
            title: job.position,
            company: job.company || 'Empresa não identificada',
            link: job.url.startsWith('http') ? job.url : `https://remoteok.com/remote-jobs/${job.id}`,
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
            if (!isLikelyJobPosting(item.link, item.title)) continue;
            const description = (item.description || item.snippet || '').slice(0, 3000);
            const listing: JobListing = {
              title: item.title,
              company: item.company || '',
              link: item.link,
              snippet: item.snippet || description.slice(0, 280),
              description,
              location: item.location || 'Brazil',
              salary: item.salary || '',
              verifiedAt: formatVerifiedAt(),
            };
            if (!isBrazilRelevantJob(listing)) continue;
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
      if (byLink.has(listing.link)) continue;
      if (!isLikelyJobPosting(listing.link, listing.title)) {
        console.log(`[scraper] ignorado (não parece vaga): ${listing.title}`);
        continue;
      }
      if (!isBrazilRelevantJob(listing)) {
        console.log(`[scraper] ignorado (fora do Brasil): ${listing.title}`);
        continue;
      }

      const detailed = enrich
        ? await this.fetchJobDetails(listing)
        : {
            ...listing,
            verifiedAt: listing.verifiedAt || formatVerifiedAt(),
          };
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
    const providers = [
      ['Bing', Boolean(process.env.BING_SEARCH_API_KEY)],
      ['SerpAPI', Boolean(process.env.SERPAPI_API_KEY)],
      ['SearchAPI', Boolean(process.env.SEARCHAPI_API_KEY)],
    ] as const;

    const enabled = providers.filter(([, on]) => on).map(([name]) => name);
    console.log(
      `[scraper] Fallbacks de busca API: ${enabled.length ? enabled.join(', ') : 'nenhum configurado'}`
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

    const runQueryBatch = async (batch: string[], label: string) => {
      for (const query of batch) {
        if (byLink.size >= targetPool) return;
        console.log(`[scraper] (${label}) ${byLink.size}/${targetPool} | ${query}`);
        const listings = await this.searchQuery(query);
        await this.addListings(listings, byLink, targetPool, true);
      }
    };
    await runQueryBatch(queries, 'prioritário');

    if (byLink.size < targetPool && fallbackQueries.length > 0) {
      console.log(`[scraper] Pool ${byLink.size}/${targetPool}. Buscas amplas...`);
      await runQueryBatch(fallbackQueries, 'ampla');
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
      await runQueryBatch(this.buildExpansionQueries(round), `expansão-${round}`);
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
