import { describe, expect, it } from 'vitest';
import { guessCompany } from '../../src/infrastructure/scraping/scraper';

describe('guessCompany', () => {
  it('usa subdomínio Gupy em vez de regex no título', () => {
    expect(
      guessCompany(
        'Página da Vaga | Desenvolvedor de Software - Pleno(Node)',
        'Candidaturas encerradas',
        'montreal.gupy.io'
      )
    ).toBe('Montreal');
  });

  it('não confunde "na" dentro de Página com empresa', () => {
    expect(
      guessCompany(
        'Página da Vaga | Desenvolvedor Node',
        'Vaga remota',
        'example.com'
      )
    ).not.toBe('Vaga');
  });

  it('extrai empresa com "na Empresa" no título', () => {
    expect(
      guessCompany('Desenvolvedor Node na Acme Tech', '', 'boards.greenhouse.io')
    ).toBe('Acme Tech');
  });
});
