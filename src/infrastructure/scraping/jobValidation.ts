const TRACKING_PARAMS = new Set([
  'jobboardsource',
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
]);

const CLOSED_JOB_PATTERN =
  /candidaturas?\s+encerradas?|inscri[cç][oõ]es?\s+encerradas?|vaga\s+encerrada|processo\s+encerrado|n[aã]o\s+est[aá]\s+(mais\s+)?aceitand[oa]|applications?\s+closed|no\s+longer\s+accepting|position\s+(has\s+been\s+)?closed|this\s+job\s+is\s+(no\s+longer|closed)/i;

export const CLOSED_JOB_REASON = 'Vaga encerrada / candidaturas fechadas';

export function isClosedJobText(text: string | undefined | null): boolean {
  if (!text) return false;
  return CLOSED_JOB_PATTERN.test(text);
}

export function jobTextBlob(
  parts: Array<string | undefined | null>
): string {
  return parts.filter(Boolean).join(' ');
}

function shouldDropParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower.startsWith('utm_')) return true;
  return TRACKING_PARAMS.has(lower);
}

function canonicalizeGupy(url: URL): void {
  if (!url.hostname.toLowerCase().includes('gupy.io')) return;
  const match = url.pathname.match(/\/jobs\/(\d+)/i);
  if (match) {
    url.pathname = `/jobs/${match[1]}`;
  }
}

/** Bing /ck/a wraps the target URL in the `u` param (`a1` prefix + base64url). */
function unwrapBingClickUrl(href: string): string | null {
  try {
    const url = new URL(href, 'https://www.bing.com');
    if (!url.hostname.toLowerCase().includes('bing.com')) return null;
    if (!url.pathname.includes('/ck/')) return null;

    const raw = url.searchParams.get('u');
    if (!raw) return null;

    let encoded = raw.startsWith('a1') ? raw.slice(2) : raw;
    encoded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    while (encoded.length % 4 !== 0) encoded += '=';

    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Normalize job URL for dedup: unwrap search redirects, strip tracking
 * params, Gupy canonical `/jobs/{id}`, lowercase host.
 */
export function canonicalizeJobLink(href: string): string | null {
  try {
    if (!href) return null;

    if (href.startsWith('/url?') || (href.includes('google.') && href.includes('/url?'))) {
      const url = new URL(href, 'https://www.google.com');
      const q = url.searchParams.get('q') || url.searchParams.get('url');
      if (q) return canonicalizeJobLink(q);
    }

    if (href.startsWith('/l/?') || href.includes('duckduckgo.com/l/')) {
      const url = new URL(href, 'https://duckduckgo.com');
      const uddg = url.searchParams.get('uddg');
      if (uddg) return canonicalizeJobLink(uddg);
    }

    const bingTarget = unwrapBingClickUrl(href);
    if (bingTarget) return canonicalizeJobLink(bingTarget);

    const url = new URL(href);
    const host = url.hostname.toLowerCase();

    if (
      host.includes('google.') ||
      host.includes('duckduckgo.com') ||
      host.includes('bing.com')
    ) {
      return null;
    }

    url.hostname = host;
    url.hash = '';

    for (const key of [...url.searchParams.keys()]) {
      if (shouldDropParam(key)) {
        url.searchParams.delete(key);
      }
    }

    canonicalizeGupy(url);

    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return null;
  }
}
