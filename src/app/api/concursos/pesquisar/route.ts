import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 35;

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
  if (value.includes('conhecimento.fgv.br/concursos')) score += 120;
  if (value.includes('gov.br') || value.includes('.pa.gov.br')) score += 45;
  if (/edital|concurso|processo seletivo/.test(value)) score += 18;
  if (/resultado|gabarito|classifica[cç][aã]o|demanda por vaga/.test(value)) score -= 12;
  for (const term of terms) {
    const normalized = term.toLowerCase();
    if (normalized.length > 2 && value.includes(normalized)) score += 4;
  }
  return score;
}

async function search(term: string): Promise<Result[]> {
  const response = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(term), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Futurador/1.0)', Accept: 'text/html' },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  });
  if (!response.ok) return [];
  const html = await response.text();
  const matches = [...html.matchAll(/<a\b(?=[^>]*\bclass=["'][^"']*result__a)(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/gi)];
  const output: Result[] = [];
  for (const match of matches) {
    const href = match[1] || match[0].match(/\bhref=["']([^"']+)["']/i)?.[1];
    const url = href ? target(href) : null;
    if (!url) continue;
    const around = html.slice(Math.max(0, match.index! - 1600), Math.min(html.length, match.index! + 3000));
    const snippetMatch = around.match(/class=["']result__snippet["'][^>]*>([\s\S]*?)<\/div>/i);
    let source = '';
    try { source = new URL(url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
    output.push({ title: clean(match[2]).slice(0, 220), url, snippet: snippetMatch ? clean(snippetMatch[1]).slice(0, 420) : '', source });
  }
  return output;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (query.length < 3 || query.length > 160) {
      return NextResponse.json({ error: 'Informe o nome do concurso (de 3 a 160 caracteres).' }, { status: 400 });
    }

    const normalized = query.replace(/[.,;:_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const yearMatch = normalized.match(/\b20\d{2}\b/);
    const year = yearMatch?.[0] || null;
    const base = normalized.replace(/\b20\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
    const searchTerms = year
      ? [
          normalized + ' concurso edital',
          normalized + ' página oficial',
          base + ' ' + year + ' banca organizadora',
          base + ' ' + year + ' cargos conteúdo programático',
          base + ' ' + year,
        ]
      : [
          normalized,
          normalized + ' concurso',
          normalized + ' edital',
          normalized + ' banca organizadora',
          normalized + ' cargos prova conteúdo programático',
        ];

    const lower = normalized.toLowerCase();
    const isSeducPa = /seduc/.test(lower) && /\bpa\b|pará|para/.test(lower);
    if (isSeducPa && year === '2026') {
      searchTerms.unshift('site:conhecimento.fgv.br/concursos/seducpa26 SEDUC Pará 2026 FGV edital');
    }

    const batches = await Promise.all(searchTerms.map((term) => search(term).catch(() => [])));
    const unique = new Map<string, Result>();
    for (const item of batches.flat()) {
      const previous = unique.get(item.url);
      if (!previous || item.snippet.length > previous.snippet.length) unique.set(item.url, item);
    }

    if (isSeducPa && year === '2026') {
      const official = 'https://conhecimento.fgv.br/concursos/seducpa26';
      unique.set(official, {
        title: 'Concurso Público SEDUC-PA 2026 — FGV Conhecimento (página oficial)',
        url: official,
        snippet: 'Página oficial do concurso da SEPLAD e da Secretaria de Estado de Educação do Pará. Reúne edital, retificações, cronograma e publicações oficiais.',
        source: 'conhecimento.fgv.br',
      });
    }

    let results = [...unique.values()];
    // Quando o usuário informa um ano, não misturar concursos de outras edições.
    if (year) {
      results = results.filter((item) => (item.title + ' ' + item.url + ' ' + item.snippet).includes(year));
    }
    results.sort((a, b) => rank(b, [base, year || '']) - rank(a, [base, year || '']));
    results = results.filter((item) => rank(item, [base]) > 0).slice(0, 20);

    return NextResponse.json({
      query,
      results,
      searchedAt: new Date().toISOString(),
      searchMode: year ? 'year-filtered' : 'broad',
      yearFilter: year,
      message: year
        ? 'Resultados limitados ao ano informado.'
        : 'Busca ampliada: selecione o resultado que corresponde ao concurso desejado.',
    });
  } catch {
    return NextResponse.json({ error: 'O serviço de pesquisa não respondeu. Tente novamente em instantes.' }, { status: 502 });
  }
}
