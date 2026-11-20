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

const OFFICIAL_EXAM_BOARD_DOMAINS = [
  'conhecimento.fgv.br',
  'fgv.br',
  'cebraspe.org.br',
  'concursosfcc.com.br',
  'vunesp.com.br',
  'ibfc.org.br',
  'institutoaocp.org.br',
  'consulplan.net',
  'idecan.org.br',
  'iades.com.br',
  'quadrix.org.br',
  'fundatec.org.br',
  'fepese.org.br',
  'legalleconcursos.com.br',
  'objetivas.com.br',
  'msconcursos.com.br',
  'selecon.org.br',
  'institutoverbena.ufg.br',
  'avalia.org.br',
  'access.org.br',
  'institutoconsulplan.org.br',
  'institutoconsulplan.org',
];

function isOfficialExamBoardUrl(rawUrl: string) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\\./, '');
    return OFFICIAL_EXAM_BOARD_DOMAINS.some((domain) => host === domain || host.endsWith('.' + domain));
  } catch {
    return false;
  }
}

// Além da banca, o próprio órgão público pode publicar e hospedar o edital.
// Isso é comum em concursos de polícias, prefeituras, secretarias e tribunais.
function isOfficialPublicBodyUrl(rawUrl: string) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\\./, '');
    return host.endsWith('.gov.br') || host.endsWith('.leg.br') ||
      host.endsWith('.jus.br') || host.endsWith('.mil.br');
  } catch {
    return false;
  }
}

function isTrustedOfficialUrl(rawUrl: string) {
  return isOfficialExamBoardUrl(rawUrl) || isOfficialPublicBodyUrl(rawUrl);
}

function queryAliases(query: string) {
  const normalized = query.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toUpperCase();
  const aliases: string[] = [];
  if (/\\bPMSP\\b|\\bPMESP\\b/.test(normalized)) {
    aliases.push('Polícia Militar do Estado de São Paulo', 'PMESP', 'concursos.policiamilitar.sp.gov.br');
  }
  if (/\\bPMSC\\b/.test(normalized)) {
    aliases.push('Polícia Militar de Santa Catarina', 'PM Santa Catarina', 'pm.sc.gov.br', 'Instituto AOCP');
  }
  if (/\\bPMERJ\\b/.test(normalized)) {
    aliases.push('Polícia Militar do Estado do Rio de Janeiro', 'PMERJ');
  }
  if (/\\bPMMG\\b/.test(normalized)) {
    aliases.push('Polícia Militar de Minas Gerais', 'PMMG');
  }
  if (/\\bPMPR\\b/.test(normalized)) {
    aliases.push('Polícia Militar do Paraná', 'PMPR');
  }
  if (/\\bPCSP\\b/.test(normalized)) {
    aliases.push('Polícia Civil do Estado de São Paulo');
  }
  if (/\\bPCSC\\b/.test(normalized)) {
    aliases.push('Polícia Civil de Santa Catarina');
  }
  return aliases;
}

function rank(item: Result, terms: string[]) {
  const value = (item.url + ' ' + item.title + ' ' + item.snippet).toLowerCase();
  let score = 100;
  if (value.includes('conhecimento.fgv.br/concursos')) score += 150;
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

  const aliases = queryAliases(query);
  if (aliases.length) {
    const expanded = aliases.join(' ');
    add(expanded + ' concurso edital');
    add(expanded + ' concurso público site:gov.br');
  }

  // Prefeituras frequentemente publicam o edital no próprio portal municipal,
  // sem contratar uma banca externa. Pesquise diretamente fontes governamentais.
  if (/prefeitura|municipio|municipal/i.test(base)) {
    add(base + ' concurso edital processo seletivo site:gov.br');
    add(base + ' edital oficial prefeitura');
    add(base + ' processo seletivo site:gov.br');
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
    const aliases = queryAliases(normalized);
    if (aliases.length) searchTerms.push(...aliases.map((alias) => alias + ' concurso edital'));
    const expandedTerms = [...new Set([normalized, ...aliases])];

    const batches = await Promise.all(searchTerms.map((term) => search(term).catch(() => [])));
    const unique = new Map<string, Result>();
    for (const item of batches.flat()) {
      const previous = unique.get(item.url);
      if (!previous || item.snippet.length > previous.snippet.length) unique.set(item.url, item);
    }

    // Mantém apenas fontes oficiais: banca organizadora ou órgão público.
    let results = [...unique.values()].filter((item) => isTrustedOfficialUrl(item.url));

    // Prefira o ano informado, mas não elimine todos os resultados se o índice
    // de busca não repetir o ano no título, URL ou trecho.
    let yearFilterApplied = false;
    if (year) {
      const yearMatches = results.filter((item) => (item.title + ' ' + item.url + ' ' + item.snippet).includes(year));
      if (yearMatches.length > 0) {
        results = yearMatches;
        yearFilterApplied = true;
      }
    }

    const queryWords: string[] = expandedTerms.join(' ').toLowerCase().split(/\\s+/)
      .filter((word: string) => word.length > 1 && !/^20\\d{2}$/.test(word));
    results.sort((a, b) => rank(b, queryWords) - rank(a, queryWords));

    return NextResponse.json({
      query,
      results,
      searchedAt: new Date().toISOString(),
      searchMode: yearFilterApplied ? 'year-filtered' : 'broad',
      yearFilter: year,
      officialSourcesOnly: true,
      message: yearFilterApplied
        ? 'Resultados oficiais priorizados para o ano informado.'
        : 'Busca ampliada em bancas organizadoras e portais oficiais dos órgãos públicos. Não foram exibidos sites divulgadores.',
    });
  } catch {
    return NextResponse.json({ error: 'O serviço de pesquisa não respondeu. Tente novamente em instantes.' }, { status: 502 });
  }
}
