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
  const model = process.env.FUTURADOR_AI_MODEL;
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!model || !token) return fail('A integração de IA ainda não está configurada no servidor.', 503);

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

  let gatewayResponse: Response;
  try {
    gatewayResponse = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Responda somente JSON válido, seguindo exatamente o esquema solicitado.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 14000,
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return fail('Não foi possível conectar ao serviço de IA. Tente novamente mais tarde.', 502);
  }

  if (!gatewayResponse.ok) {
    const status = gatewayResponse.status;
    if (status === 401 || status === 403) return fail('A autenticação do serviço de IA não foi aceita. Verifique a configuração do servidor.', 502);
    if (status === 402) return fail('O serviço de IA informou que não há créditos disponíveis. Nenhuma alteração foi feita no edital.', 402);
    if (status === 429) return fail('O serviço de IA está temporariamente limitado. Aguarde e tente novamente.', 429);
    return fail('O serviço de IA não conseguiu analisar este edital (código ' + status + ').', 502);
  }

  try {
    const response = await gatewayResponse.json();
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Resposta vazia da IA.');
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
