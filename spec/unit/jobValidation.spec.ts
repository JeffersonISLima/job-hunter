import { describe, expect, it } from 'vitest';
import {
  canonicalizeJobLink,
  isClosedJobText,
} from '../../src/infrastructure/scraping/jobValidation';

describe('canonicalizeJobLink', () => {
  it('remove jobBoardSource e utm_* de URL Gupy e canônica /jobs/{id}', () => {
    const input =
      'https://Montreal.gupy.io/jobs/11575472?jobBoardSource=gupypublicpage&utm_source=google&utm_medium=cpc';
    expect(canonicalizeJobLink(input)).toBe(
      'https://montreal.gupy.io/jobs/11575472'
    );
  });

  it('remove trailing slash', () => {
    expect(canonicalizeJobLink('https://example.com/jobs/1/')).toBe(
      'https://example.com/jobs/1'
    );
  });

  it('unwrap link do Google /url?q=', () => {
    const nested = encodeURIComponent(
      'https://acme.gupy.io/jobs/99?jobBoardSource=gupypublicpage'
    );
    expect(canonicalizeJobLink(`https://www.google.com/url?q=${nested}`)).toBe(
      'https://acme.gupy.io/jobs/99'
    );
  });

  it('unwrap DuckDuckGo uddg=', () => {
    const nested = encodeURIComponent('https://programathor.com.br/jobs/42?utm_source=ddg');
    expect(
      canonicalizeJobLink(`https://duckduckgo.com/l/?uddg=${nested}`)
    ).toBe('https://programathor.com.br/jobs/42');
  });

  it('unwrap link do Bing /ck/a (param u base64)', () => {
    const target = 'https://acme.gupy.io/jobs/42?jobBoardSource=gupypublicpage';
    const encoded = Buffer.from(target)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const bing = `https://www.bing.com/ck/a?!&&u=a1${encoded}`;
    expect(canonicalizeJobLink(bing)).toBe('https://acme.gupy.io/jobs/42');
  });

  it('descarta hosts de busca', () => {
    expect(canonicalizeJobLink('https://www.google.com/search?q=node')).toBeNull();
    expect(canonicalizeJobLink('https://duckduckgo.com/?q=node')).toBeNull();
    expect(canonicalizeJobLink('https://www.bing.com/search?q=node')).toBeNull();
  });

  it('remove gclid e fbclid', () => {
    expect(
      canonicalizeJobLink('https://example.com/job?gclid=abc&fbclid=xyz&id=1')
    ).toBe('https://example.com/job?id=1');
  });
});

describe('isClosedJobText', () => {
  it('detecta frases Gupy de candidaturas/inscrições encerradas', () => {
    expect(isClosedJobText('Candidaturas encerradas')).toBe(true);
    expect(isClosedJobText('Publicada em 02 de julho. Inscrições encerradas')).toBe(
      true
    );
  });

  it('detecta equivalentes em inglês', () => {
    expect(isClosedJobText('Applications closed')).toBe(true);
    expect(isClosedJobText('No longer accepting applications')).toBe(true);
  });

  it('não marca texto de vaga aberta', () => {
    expect(isClosedJobText('Vaga aberta para Desenvolvedor Node.js Pleno')).toBe(
      false
    );
    expect(isClosedJobText('Candidate-se agora. Inscrições até o fim do mês')).toBe(
      false
    );
  });

  it('trata vazio/null', () => {
    expect(isClosedJobText('')).toBe(false);
    expect(isClosedJobText(null)).toBe(false);
    expect(isClosedJobText(undefined)).toBe(false);
  });
});
