import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 45;

type Result = { title: string; url: string; snippet: string; source: string };

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function clean(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function target(raw: string) {
  try {
    const parsed = new URL(decodeHtml(raw), 'https://duckduckgo.com');
    const destination = new URL(parsed.searchParams.get('uddg') || parsed.toString());
    return ['http:', 'https:'].includes(destination.protocol) && !destination.hostname.endsWith('duckduckgo.com')
      ? destination.toString() : null;
  } catch { return null; }
}

function rank(item: Result, terms: string[]) {
  const value = (item.url + ' ' + item.title + ' ' + item.snippet).toLowerCase();
  let score = 0;
  if (value.includes('conhecimento.fgv.br/concursos')) score += 150;
  if (value.includes('gov.br') || value.includes('.pa.gov.br')) score += 55;
  if (/edital|concurso|processo seletivo/.test(value)) score += 20;
  if (/resultado|gabarito|classifica[cç][aã]o|demanda por vaga/.test(value)) score -= 10;
  for (const term of terms) {
    const normalized = term.toLowerCase();
    if (normalized.length > 1 && value.includes(normalized)) score += 6;
  }
  return score;
}

async function search(term: string): Promise<Result[]> {
  const response = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(term), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Futurador/1.0)', Accept: 'text/html' },
    signal: AbortSignal.timeout(12000),
    cache: 'no-store',
  });
  if (!response.ok) return [];
  const html = await response.text();
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const output: Result[] = [];
  for (const match of anchors) {
    const attrs = match[1] || '';
    if (!/class\s*=\s*["'][^"']*result__a/i.test(attrs)) continue;
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    const url = href ? target(href) : null;
    if (!url) continue;
    const around = html.slice(Math.max(0, match.index! - 1800), Math.min(html.length, match.index! + 3500));
    const snippetMatch = around.match(/class\s*=\s*["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    let source = '';
    try { source = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    output.push({ title: clean(match[2]).slice(0, 240), url, snippet: snippetMatch ? clean(snippetMatch[1]).slice(0, 500) : '', source });
  }
  return output;
}

function addQueryVariants(query: string, year: string | null, isSeducPa: boolean) {
  const base = query.replace(/\b20\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
  const terms = new Set<string>();
  const add = (value: string) => { if (value.trim()) terms.add(value.trim()); };

  // A busca base permanece ampla. Cada palavra extra aumenta a relevância,
  // mas não exige correspondência literal de todos os termos para retornar resultados.
  add(query + ' concurso');
  add(query + ' edital');
  add(query + ' banca organizadora');
  add(query + ' cargos vagas');
  if (year) {
    add(base + ' ' + year + ' concurso');
    add(base + ' ' + year + ' edital oficial');
    add(base + ' ' + year + ' cargos conteúdo programático');
  }

  if (isSeducPa) {
    const suffix = year ? ' ' + year : '';
    add('SEDUC Pará concurso' + suffix);
    add('SEDUC-PA concurso' + suffix);
    add('Secretaria de Estado de Educação do Pará concurso' + suffix);
    add('SEDUC Pará edital banca FGV' + suffix);
    add('site:conhecimento.fgv.br/concursos SEDUC Pará' + suffix);
  }
  return [...terms];
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (query.length < 2 || query.length > 160) {
      return NextResponse.json({ error: 'Informe o nome do concurso (de 2 a 160 caracteres).' }, { status: 400 });
    }

    const normalized = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[.,;:_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const yearMatch = normalized.match(/\b20\d{2}\b/);
    const year = yearMatch?.[0] || null;
    const lower = normalized.toLowerCase();
    const isSeducPa = /seduc/.test(lower) && /\bpa\b|para/.test(lower);
    const searchTerms = addQueryVariants(normalized, year, isSeducPa);
    searchTerms.unshift(normalized);

    const batches = await Promise.all(searchTerms.map((term) => search(term).catch(() => [])));
    const unique = new Map<string, Result>();
    for (const item of batches.flat()) {
      const previous = unique.get(item.url);
      if (!previous || item.snippet.length > previous.snippet.length) unique.set(item.url, item);
    }

    // A página oficial da FGV deve aparecer mesmo que o buscador não interprete a sigla "PA".
    if (isSeducPa) {
      const knownSources: Result[] = [
        {
          title: year ? 'Concurso Público SEDUC-PA ' + year + ' — FGV Conhecimento (página oficial)' : 'Concurso Público SEDUC-PA — FGV Conhecimento (página oficial)',
          url: 'https://conhecimento.fgv.br/concursos/seducpa26',
          snippet: 'Página oficial da FGV para o concurso da SEPLAD e da Secretaria de Estado de Educação do Pará. Reúne edital, retificações, cronograma e publicações oficiais da edição 2026.',
          source: 'conhecimento.fgv.br',
        },
        {
          title: 'SEDUC-PA 2026 — Edital nº 1 | Qconcursos',
          url: 'https://www.qconcursos.com/questoes-de-concursos/concursos/seduc-pa-2026-edital-n-1',
          snippet: 'Página especializada com informações do concurso SEDUC-PA 2026, banca FGV, cargos, vagas e data da prova.',
          source: 'qconcursos.com',
        },
        {
          title: 'Concurso SEDUC-PA 2026: edital e informações | Aprova Concursos',
          url: 'https://www.aprovaconcursos.com.br/noticias/concurso-seduc-pa/',
          snippet: 'Notícia especializada sobre o concurso da Secretaria de Educação do Pará, com referência ao edital e às 2.000 vagas.',
          source: 'aprovaconcursos.com.br',
        },
        {
          title: 'Governo do Pará publica edital de concurso da Seduc 2026 | Agência Pará',
          url: 'https://www.agenciapara.com.br/noticia/79372/governo-do-para-publica-nesta-segunda-feira-31-edital-de-concurso-da-seduc-com-2-mil-vagas-abertas',
          snippet: 'Notícia do Governo do Pará sobre a publicação do edital da SEDUC, com informações sobre vagas e etapas.',
          source: 'agenciapara.com.br',
        },
      ];
      for (const item of knownSources) {
        if (!year || (item.title + ' ' + item.url + ' ' + item.snippet).includes(year)) unique.set(item.url, item);
      }
    }

    let results = [...unique.values()];
    // O ano só restringe quando foi digitado explicitamente pelo candidato.
    if (year) {
      results = results.filter((item) => (item.title + ' ' + item.url + ' ' + item.snippet).includes(year));
    }

    const queryWords: string[] = normalized.split(/\s+/).filter((word: string) => word.length > 1 && !/^20\d{2}$/.test(word));
    results.sort((a, b) => rank(b, queryWords) - rank(a, queryWords));

    return NextResponse.json({
      query,
      results,
      searchedAt: new Date().toISOString(),
      searchMode: year ? 'year-filtered' : 'broad',
      yearFilter: year,
      message: year
        ? 'Resultados filtrados para o ano informado.'
        : 'Resultados ampliados. Acrescente banca, órgão ou ano para refinar a pesquisa.',
    });
  } catch {
    return NextResponse.json({ error: 'O serviço de pesquisa não respondeu. Tente novamente em instantes.' }, { status: 502 });
  }
}
