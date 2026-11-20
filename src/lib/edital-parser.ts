export type ParsedSubject = {
  name: string;
  topics: string[];
  scope: 'common' | 'specific';
  positionName: string | null;
  positionNames?: string[];
  module?: 'basic' | 'specific';
  questionCount?: number | null;
  examStage?: string;
  sourcePage?: number | null;
  sourceExcerpt?: string | null;
  topicSources?: Array<{ title: string; sourcePage: number; sourceExcerpt: string }>;
};
export type ParsedPosition = {
  name: string;
  code: string | null;
  formation?: string | null;
  educationLevel?: string | null;
  sourceAnnex?: string | null;
  sourcePage?: number | null;
  sourceExcerpt?: string | null;
};
export type ParsedEdital = { positions: ParsedPosition[]; subjects: ParsedSubject[]; warnings: string[] };

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}
function clean(value: string) { return value.replace(/\s+/g, ' ').replace(/^[-•▪◦]+\s*/, '').trim(); }
function escapeRegex(value: string) { return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); }
function splitTopics(value: string) {
  return value.replace(/\[\[PAGE:\d+\]\]/g, ' ').split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9])/)
    .map(item => item.replace(/\s+/g, ' ').replace(/^\d+\.\s*/, '').trim()).filter(item => item.length > 12);
}

const professorFormations = ['Matemática', 'Língua Portuguesa', 'História', 'Geografia', 'Filosofia', 'Sociologia', 'Física', 'Química', 'Biologia', 'Língua Inglesa', 'Artes', 'Educação Física', 'Educação Especial - AEE', 'Educação Especial - LIBRAS'];
const roleGroups = [
  { role: 'Professor Classe I', formations: professorFormations, level: 'Nível Superior' },
  { role: 'Especialista em Educação', formations: ['Especialista em Educação'], level: 'Nível Superior' },
  { role: 'Analista de Gestão Governamental e Política Educacional', formations: ['Administração', 'Ciências Contábeis', 'Ciências Econômicas', 'Estatística'], level: 'Nível Superior' },
  { role: 'Analista de Gestão Governamental e Infraestrutura Educacional', formations: ['Arquitetura e Urbanismo', 'Engenharia Civil', 'Engenharia Elétrica'], level: 'Nível Superior' },
  { role: 'Analista de Suporte Educacional', formations: ['Nutrição', 'Psicologia', 'Serviço Social'], level: 'Nível Superior' },
  { role: 'Assistente de Gestão Governamental e Educacional', formations: ['Assistente de Gestão Governamental e Educacional'], level: 'Nível Médio' },
];

function extractFgvPositions(text: string): ParsedPosition[] {
  const normalized = normalize(text).replace(/\[\[PAGE:\d+\]\]/g, ' ').replace(/GOVERNAMENT\s+AL/g, 'GOVERNAMENTAL').replace(/ADMINISTRACA\s+O/g, 'ADMINISTRACAO');
  const start = normalized.indexOf('ANEXO II - QUADRO DE VAGAS');
  if (start < 0) return [];
  const endCandidates = [normalized.indexOf('ANEXO II-A', start + 10), normalized.indexOf('ANEXO III', start + 10)].filter(index => index >= 0);
  const appendix = normalized.slice(start, endCandidates.length ? Math.min(...endCandidates) : Math.min(normalized.length, start + 180000));
  const positions: ParsedPosition[] = [];
  const seen = new Set<string>();
  for (const group of roleGroups) {
    for (const formation of group.formations) {
      const form = escapeRegex(normalize(formation));
      const role = escapeRegex(normalize(group.role));
      const pattern = group.role === 'Professor Classe I'
        ? new RegExp('PROFESSOR\\s+' + form + '\\s+NIVEL\\s+SUPERIOR', 'g')
        : group.role === 'Especialista em Educação'
          ? /ESPECIALISTA\s+EM\s+EDUCACAO(?:\s+ESPECIALISTA\s+EM\s+EDUCACAO)?\s+NIVEL\s+SUPERIOR/g
          : group.role.startsWith('Assistente')
            ? /ASSISTENTE\s+DE\s+GESTAO\s+GOVERNAMENTAL\s+E\s+EDUCACIONAL(?:\s+ASSISTENTE\s+DE\s+GESTAO\s+GOVERNAMENTAL\s+E\s+EDUCACIONAL)?\s+NIVEL\s+MEDIO/g
            : new RegExp(role + '\\s+' + form + '\\s+NIVEL\\s+SUPERIOR', 'g');
      if (!pattern.test(appendix)) continue;
      const name = group.role === 'Especialista em Educação' || group.role.startsWith('Assistente') ? group.role : group.role + ' — ' + formation;
      const key = normalize(name);
      if (!seen.has(key)) {
        seen.add(key);
        positions.push({ name, code: null, formation: group.role === 'Especialista em Educação' ? null : formation, educationLevel: group.level, sourceAnnex: 'Anexo II – Quadro de Vagas' });
      }
    }
  }
  return positions;
}

function extractNamedSubjects(block: string, definitions: Array<{ label: string; positionName?: string | null; module: 'basic' | 'specific'; questions?: number }>, scope: 'common' | 'specific', groupPositionNames: string[] = []) {
  const matches: Array<{ start: number; end: number; definition: typeof definitions[number] }> = [];
  for (const definition of definitions) {
    // Match only headings at the start of a PDF text line. Matching after any
    // sentence-ending dot also captured words mentioned inside another subject.
    const pattern = new RegExp('(?:^|\\n)[\\t ]*(' + escapeRegex(definition.label) + ')\\s*\\.', 'gim');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(block)) !== null) {
      const offset = match.index + match[0].lastIndexOf(match[1]);
      matches.push({ start: offset, end: offset + match[1].length + 1, definition });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  const subjects: ParsedSubject[] = [];
  for (let index = 0; index < matches.length; index++) {
    const current = matches[index];
    const body = block.slice(current.end, matches[index + 1]?.start ?? block.length).trim();
    const topics = splitTopics(body);
    if (!topics.length) continue;
    subjects.push({ name: current.definition.label, topics, scope, positionName: current.definition.positionName || null, positionNames: scope === 'common' ? groupPositionNames : [], module: current.definition.module, questionCount: current.definition.questions ?? null, examStage: 'Prova objetiva' });
  }
  return subjects;
}

function parseFgvSeduc(text: string): ParsedEdital | null {
  const normalized = normalize(text).replace(/\[\[PAGE:\d+\]\]/g, ' ');
  if (!normalized.includes('ANEXO V - CONTEUDO PROGRAMATICO') || !normalized.includes('ANEXO II - QUADRO DE VAGAS')) return null;

  const positions = extractFgvPositions(text);
  if (!positions.length) return null;

  // Preserve line breaks from PDF.js: discipline titles are standalone lines.
  const flat = text
    .replace(/\[\[PAGE:\d+\]\]/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  const contentStart = flat.search(/4\.\s*DO\s+CONTE[ÚU]DO\s+PROGRAM[ÁA]TICO/i);
  if (contentStart < 0) return null;
  const content = flat.slice(contentStart);

  const sectionMatches = Array.from(content.matchAll(/(?:^|\n)[\t ]*4\.[\t ]*(\d+)\.[^\n]*/g));
  const subjects: ParsedSubject[] = [];
  const commonBase = [
    { label: 'Língua Portuguesa', module: 'basic' as const, questions: 10 },
    { label: 'Raciocínio Lógico', module: 'basic' as const, questions: 10 },
    { label: 'Atualidades', module: 'basic' as const, questions: 10 },
    { label: 'Conhecimentos Pedagógicos', module: 'basic' as const, questions: 10 },
  ];
  const professorSpecific = [
    ['Matemática', 'Professor Classe I — Matemática'], ['Português', 'Professor Classe I — Língua Portuguesa'],
    ['História', 'Professor Classe I — História'], ['Geografia', 'Professor Classe I — Geografia'],
    ['Filosofia', 'Professor Classe I — Filosofia'], ['Sociologia', 'Professor Classe I — Sociologia'],
    ['Física', 'Professor Classe I — Física'], ['Química', 'Professor Classe I — Química'],
    ['Biologia', 'Professor Classe I — Biologia'], ['Inglês', 'Professor Classe I — Língua Inglesa'],
    ['Artes', 'Professor Classe I — Artes'], ['Educação Física', 'Professor Classe I — Educação Física'],
    ['Educação Especial', 'Professor Classe I — Educação Especial - AEE'], ['Língua Portuguesa Libras', 'Professor Classe I — Educação Especial - LIBRAS'], ['Especialista em Educação', 'Especialista em Educação'],
  ] as const;

  for (let sectionIndex = 0; sectionIndex < sectionMatches.length; sectionIndex++) {
    const section = sectionMatches[sectionIndex];
    const number = Number(section[1]);
    const sectionStart = section.index! + section[0].length;
    const sectionEnd = sectionMatches[sectionIndex + 1]?.index ?? content.length;
    const sectionText = content.slice(sectionStart, sectionEnd);
    const sectionPositions = number === 1
      ? positions.filter(position => position.name.startsWith('Professor Classe I') || position.name === 'Especialista em Educação')
      : number === 2 ? positions.filter(position => position.name.startsWith('Analista de Suporte Educacional'))
      : number === 3 ? positions.filter(position => position.name.startsWith('Analista de Gestão Governamental'))
      : positions.filter(position => position.name.startsWith('Assistente de Gestão'));
    if (!sectionPositions.length) continue;

    // Remove accents without collapsing whitespace so offsets remain valid.
    const normalizedSection = sectionText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const basicIndex = normalizedSection.indexOf('CONHECIMENTOS BASICOS');
    const specificIndex = normalizedSection.indexOf('CONHECIMENTOS ESPECIFICOS');
    if (basicIndex >= 0 && specificIndex > basicIndex) {
      const basicBlock = sectionText.slice(basicIndex + 'CONHECIMENTOS BÁSICOS'.length, specificIndex);
      const definitions = number === 1
        ? commonBase.map(item => ({ ...item, questions: item.label === 'Raciocínio Lógico' || item.label === 'Atualidades' ? 5 : item.questions }))
        : commonBase.filter(item => item.label !== 'Conhecimentos Pedagógicos');
      subjects.push(...extractNamedSubjects(basicBlock, definitions, 'common', sectionPositions.map(position => position.name)));
    }

    if (specificIndex >= 0) {
      const specificBlock = sectionText.slice(specificIndex + 'CONHECIMENTOS ESPECÍFICOS'.length);
      let definitions: Array<{ label: string; positionName?: string | null; module: 'basic' | 'specific'; questions?: number }> = [];
      if (number === 1) definitions = professorSpecific.map(([label, positionName]) => ({ label, positionName, module: 'specific', questions: 30 }));
      else if (number === 2) definitions = [
        { label: 'Nutricionista', positionName: 'Analista de Suporte Educacional — Nutrição', module: 'specific', questions: 30 },
        { label: 'Psicólogo', positionName: 'Analista de Suporte Educacional — Psicologia', module: 'specific', questions: 30 },
        { label: 'Assistente Social', positionName: 'Analista de Suporte Educacional — Serviço Social', module: 'specific', questions: 30 },
      ];
      else if (number === 3) definitions = [
        { label: 'Arquiteto', positionName: 'Analista de Gestão Governamental e Infraestrutura Educacional — Arquitetura e Urbanismo', module: 'specific', questions: 30 },
        { label: 'Engenheiro Civil', positionName: 'Analista de Gestão Governamental e Infraestrutura Educacional — Engenharia Civil', module: 'specific', questions: 30 },
        { label: 'Engenheiro Elétrico', positionName: 'Analista de Gestão Governamental e Infraestrutura Educacional — Engenharia Elétrica', module: 'specific', questions: 30 },
        { label: 'Administrador', positionName: 'Analista de Gestão Governamental e Política Educacional — Administração', module: 'specific', questions: 30 },
        { label: 'Contador', positionName: 'Analista de Gestão Governamental e Política Educacional — Ciências Contábeis', module: 'specific', questions: 30 },
        { label: 'Economista', positionName: 'Analista de Gestão Governamental e Política Educacional — Ciências Econômicas', module: 'specific', questions: 30 },
        { label: 'Estatística', positionName: 'Analista de Gestão Governamental e Política Educacional — Estatística', module: 'specific', questions: 30 },
      ];
      else definitions = [{ label: 'Assistente de Gestão Administrativa', positionName: 'Assistente de Gestão Governamental e Educacional', module: 'specific', questions: 30 }];
      subjects.push(...extractNamedSubjects(specificBlock, definitions, 'specific'));
    }
  }

  const warnings: string[] = [];
  if (!subjects.length) warnings.push('Os cargos foram encontrados no Anexo II, mas não foi possível relacionar com segurança os conteúdos do Anexo V. Confira a análise manualmente.');
  warnings.push('Os cargos e formações foram identificados no Anexo II; as disciplinas foram relacionadas às seções correspondentes do Anexo V. Confira a lista antes de salvar.');
  return { positions, subjects, warnings };
}

function positionFromLine(line: string): ParsedPosition | null {
  const explicit = line.match(/^\s*(?:\d+(?:\.\d+)*\s*)?CARGO\s*\d+\s*[:–—-]\s*(.{3,110})$/i);
  if (explicit) return { name: clean(explicit[1]).replace(/[.;:]$/, ''), code: null };
  const specific = line.match(/^(?:[IVX]+\.\s*)?CONHECIMENTOS ESPEC[IÍ]FICOS\s+PARA\s+O\s+CARGO\s+DE\s+(.+?)(?:\s+[-–—]\s+QUADRO\s+[IVX]+)?$/i);
  if (specific) return { name: clean(specific[1]).replace(/[.;:]$/, ''), code: null };
  const fcc = line.match(/^\s*([A-Z]\d{2})\s*[–—-]\s*((?:ANALISTA|T[ÉE]CNICO|OFICIAL|AUXILIAR|ASSISTENTE).{3,110})$/i);
  if (fcc) return { name: clean(fcc[2]).replace(/[.;:]$/, ''), code: fcc[1] };
  return null;
}
function parseGeneric(text: string): ParsedEdital {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);
  const positions: ParsedPosition[] = [];
  const subjects: ParsedSubject[] = [];
  for (const line of lines) {
    const position = positionFromLine(line);
    if (position && !positions.some(item => normalize(item.name) === normalize(position.name))) positions.push(position);
  }
  let current: ParsedSubject | null = null;
  let activePosition: string | null = null;
  let commonMode = false;
  const flush = () => { if (current?.topics.length) subjects.push(current); current = null; };
  for (const line of lines) {
    const normalized = normalize(line);
    const position = positionFromLine(line);
    if (position) { flush(); activePosition = position.name; commonMode = false; continue; }
    if (/CONHECIMENTOS (BASICOS|GERAIS).*PARA TODOS/.test(normalized)) { flush(); commonMode = true; activePosition = null; continue; }
    if (/^CONHECIMENTOS ESPECIFICOS\b/.test(normalized)) { flush(); commonMode = false; continue; }
    if (line.length < 100 && line === line.toUpperCase() && /[A-ZÀ-Ú]{3}/.test(line)) {
      flush();
      current = { name: line, topics: [], scope: commonMode || !activePosition ? 'common' : 'specific', positionName: commonMode ? null : activePosition };
      continue;
    }
    if (current) current.topics.push(line);
  }
  flush();
  const warnings = ['Formato não reconhecido com precisão. Revise os cargos, disciplinas e tópicos antes de confirmar.'];
  if (!positions.length) warnings.push('Não foi possível reconhecer automaticamente os cargos.');
  return { positions, subjects, warnings };
}
export function parseEditalText(rawText: string): ParsedEdital {
  return parseFgvSeduc(rawText) || parseGeneric(rawText);
}
