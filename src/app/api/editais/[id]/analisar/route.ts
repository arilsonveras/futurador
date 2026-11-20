import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

type TopicEvidence = { title: string; sourcePage: number; sourceExcerpt: string };
type AiPosition = {
  name: string; code: string | null; formation: string | null; educationLevel: string | null;
  sourcePage: number; sourceExcerpt: string;
};
type AiSubject = {
  name: string; topics: TopicEvidence[]; scope: 'common' | 'specific'; positionNames: string[];
  module: 'basic' | 'specific'; questionCount: number | null; examStage: string | null;
  sourcePage: number; sourceExcerpt: string;
};

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function extractJson(content: string) {
  const cleaned = content.trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('A IA não retornou um objeto JSON válido.');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function validPage(value: unknown, pageCount: number): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= pageCount;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return fail('Sua sessão expirou. Entre novamente para analisar o edital.', 401);

  const { data: exam, error: examError } = await supabase
    .from('exams').select('id, edital_file_path').eq('id', id).single();
  if (examError || !exam?.edital_file_path) return fail('Edital não encontrado ou sem PDF associado.', 404);

  const body = await request.json().catch(() => null) as { text?: unknown; pageCount?: unknown } | null;
  if (!body || typeof body.text !== 'string') return fail('O texto extraído do PDF não foi recebido.');
  const text = body.text.trim();
  const pageCount = Number(body.pageCount);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 350) return fail('Quantidade de páginas inválida.');
  if (text.length < 300) return fail('Não foi possível extrair texto suficiente do edital. O arquivo pode precisar de OCR.');
  if (text.length > 600_000) return fail('O edital é muito extenso para uma única análise. O limite atual é 600 mil caracteres.', 413);

  // AI calls remain explicitly disabled until the owner configures and enables them.
  if (process.env.FUTURADOR_AI_ENABLED !== 'true') {
    return fail('A análise por inteligência artificial está preparada, mas ainda não foi ativada. Nenhum serviço pago foi chamado.', 503);
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fail('A análise gratuita por IA está pronta, mas falta configurar a chave da API Gemini no servidor. Nenhum serviço pago foi chamado.', 503);
  const model = 'gemini-3.5-flash-lite';

  const prompt = `Você é um analista especializado em editais de concursos públicos brasileiros. Analise o conteúdo integral fornecido, respeitando a estrutura, os títulos, os anexos, os cargos e as tabelas.

REGRAS OBRIGATÓRIAS:
1. Não invente cargos, formações, disciplinas, tópicos, etapas ou número de questões.
2. Identifique cada cargo/posição exatamente como aparece no edital. Quando houver o mesmo cargo para várias formações, crie uma posição por formação.
3. Associe disciplinas comuns somente aos cargos que o edital explicitamente inclui naquele grupo/seção. Nunca associe conteúdo a todos os cargos por suposição.
4. Separe conhecimentos básicos/gerais de conhecimentos específicos.
5. Leia tabelas e listas considerando o contexto da seção, não palavras soltas que aparecem dentro de outros parágrafos.
6. Cada cargo, disciplina e tópico deve ter sourcePage e sourceExcerpt. A página é o número impresso no marcador [[PAGE:n]] do PDF; use esse número n. O trecho deve ser uma citação curta e literal do material que sustenta a identificação.
7. Se não houver evidência suficiente para um item, não o inclua. Se uma seção não puder ser interpretada, explique em warnings em vez de adivinhar.
8. Para disciplinas compartilhadas, use scope="common" e informe em positionNames todos os cargos aos quais o edital realmente aplica a disciplina. Para disciplinas próprias de um cargo/formação, use scope="specific" e positionNames com o nome exato da posição.
9. Não transforme cada frase em tópico. Agrupe o conteúdo programático em tópicos claros, preservando subitens e numeração quando existirem.
10. Responda exclusivamente com JSON válido, sem Markdown.

FORMATO:
{
 "positions":[{"name":"", "code":null, "formation":null, "educationLevel":null, "sourcePage":1, "sourceExcerpt":""}],
 "subjects":[{"name":"", "topics":[{"title":"", "sourcePage":1, "sourceExcerpt":""}], "scope":"common", "positionNames":[""], "module":"basic", "questionCount":null, "examStage":null, "sourcePage":1, "sourceExcerpt":""}],
 "warnings":[]
}
Use null quando a informação não estiver expressa. module deve ser "basic" ou "specific". scope deve ser "common" ou "specific". questionCount deve ser inteiro ou null.

PÁGINAS DO EDITAL (marcadores [[PAGE:n]]):
${text}`;

  let geminiResponse: Response | null = null;
  // O Google recomenda retry com backoff para HTTP 503 (sobrecarga temporária).
  // Duas tentativas limitam a espera e mantêm a função dentro do limite de 60s da Vercel.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      geminiResponse = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: 'Responda somente JSON válido, seguindo exatamente o esquema solicitado.' }],
            },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 14000,
              responseMimeType: 'application/json',
            },
          }),
          signal: AbortSignal.timeout(25_000),
        }
      );
    } catch {
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        continue;
      }
      return fail('Não foi possível conectar ao Gemini após uma nova tentativa. Tente novamente mais tarde.', 502);
    }

    if (geminiResponse.status !== 503 || attempt === 1) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  if (!geminiResponse) return fail('Não foi possível conectar ao Gemini. Tente novamente mais tarde.', 502);

  if (!geminiResponse.ok) {
    const status = geminiResponse.status;
    if (status === 400) return fail('O Gemini não aceitou o formato do pedido. Revise o PDF ou tente novamente.', 422);
    if (status === 401 || status === 403) return fail('A chave gratuita do Gemini não foi aceita. Verifique a configuração no servidor.', 502);
    if (status === 429) return fail('O limite gratuito do Gemini foi atingido ou está temporariamente indisponível. Aguarde a renovação da cota e tente novamente. Nenhuma cobrança será feita automaticamente por esta integração.', 429);
    if (status === 503) return fail('O Gemini está temporariamente sobrecarregado. Tente novamente mais tarde.', 503);
    return fail('O Gemini não conseguiu analisar este edital (código ' + status + ').', 502);
  }

  try {
    const response = await geminiResponse.json();
    const content = response?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text || '')
      .join('');
    if (typeof content !== 'string' || !content.trim()) throw new Error('Resposta vazia da IA.');
    const parsed = extractJson(content);
    if (!Array.isArray(parsed.positions) || !Array.isArray(parsed.subjects)) throw new Error('Estrutura da análise incompleta.');
    const positions: AiPosition[] = parsed.positions.filter((item: any) =>
      item && typeof item.name === 'string' && item.name.trim() &&
      validPage(item.sourcePage, pageCount) && typeof item.sourceExcerpt === 'string' && item.sourceExcerpt.trim()
    ).map((item: any) => ({
      name: item.name.trim(), code: typeof item.code === 'string' ? item.code : null,
      formation: typeof item.formation === 'string' ? item.formation : null,
      educationLevel: typeof item.educationLevel === 'string' ? item.educationLevel : null,
      sourcePage: item.sourcePage, sourceExcerpt: item.sourceExcerpt.slice(0, 500),
    }));
    const positionNames = new Set(positions.map(item => item.name));
    const subjects: AiSubject[] = parsed.subjects.filter((item: any) =>
      item && typeof item.name === 'string' && item.name.trim() &&
      (item.scope === 'common' || item.scope === 'specific') &&
      validPage(item.sourcePage, pageCount) && typeof item.sourceExcerpt === 'string' && item.sourceExcerpt.trim() &&
      Array.isArray(item.topics) && item.topics.length > 0
    ).map((item: any) => {
      const links = Array.isArray(item.positionNames) ? item.positionNames.filter((name: unknown) => typeof name === 'string' && positionNames.has(name)) : [];
      const topics = item.topics.filter((topic: any) =>
        topic && typeof topic.title === 'string' && topic.title.trim() &&
        validPage(topic.sourcePage, pageCount) && typeof topic.sourceExcerpt === 'string' && topic.sourceExcerpt.trim()
      ).map((topic: any) => ({
        title: topic.title.trim().slice(0, 500), sourcePage: topic.sourcePage,
        sourceExcerpt: topic.sourceExcerpt.slice(0, 500),
      }));
      return {
        name: item.name.trim(), topics, scope: item.scope,
        positionNames: links, module: item.module === 'specific' ? 'specific' : 'basic',
        questionCount: Number.isInteger(item.questionCount) && item.questionCount >= 0 ? item.questionCount : null,
        examStage: typeof item.examStage === 'string' ? item.examStage.slice(0, 120) : null,
        sourcePage: item.sourcePage, sourceExcerpt: item.sourceExcerpt.slice(0, 500),
      };
    }).filter((item: AiSubject) => item.topics.length > 0 && item.positionNames.length > 0);

    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((item: unknown) => typeof item === 'string').slice(0, 20) : [];
    if (!positions.length || !subjects.length) return fail('A IA não encontrou cargos e disciplinas com evidências suficientes. Nada foi salvo. Revise o PDF ou tente novamente.', 422);
    return NextResponse.json({
      positions,
      subjects: subjects.map(subject => ({ ...subject, positionName: subject.scope === 'specific' ? subject.positionNames[0] : null, topics: subject.topics.map(topic => topic.title), topicSources: subject.topics })),
      warnings,
      analysisMethod: 'ai',
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'A resposta da IA não pôde ser validada.', 422);
  }
}
