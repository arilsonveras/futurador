export type ParsedSubject = {
  name: string;
  topics: string[];
  scope: 'common' | 'specific';
  positionName: string | null;
};

export type ParsedPosition = { name: string; code: string | null };

export type ParsedEdital = {
  positions: ParsedPosition[];
  subjects: ParsedSubject[];
  warnings: string[];
};

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').replace(/^[-•▪◦]+\s*/, '').trim();
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

function isSubjectHeading(line: string) {
  const value = clean(line);
  if (!value || value.length > 105 || value.length < 3) return false;
  const normalized = normalize(value);
  if (['CONHECIMENTOS BASICOS', 'CONHECIMENTOS GERAIS', 'CONHECIMENTOS ESPECIFICOS', 'CONHECIMENTOS DO CARGO', 'CONTEUDO PROGRAMATICO', 'CONTEUDOS PROGRAMATICOS', 'DOS OBJETOS DE AVALIACAO', 'HABILIDADES'].includes(normalized)) return false;
  if (/^(ANEXO|APENDICE|CARGO|QUADRO|PARTE|PROVA|ETAPA|CAPITULO|ITEM)\b/.test(normalized)) return false;
  if (/^\d+(?:\.\d+)*\s/.test(value) && value.length > 75) return false;
  const letters = value.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 3) return false;
  const upper = letters.replace(/[a-zà-ÿ]/g, '').length;
  return upper / letters.length >= 0.72 && !/[.!?]$/.test(value);
}

function isCommonSection(line: string) {
  const value = normalize(line);
  return /^(?:[IVX]+\.\s*)?CONHECIMENTOS (BASICOS|GERAIS).*PARA TODOS/.test(value)
    || /^(?:[IVX]+\.\s*)?CONHECIMENTOS BASICOS PARA CARGOS/.test(value)
    || /CONHECIMENTOS GERAIS PARA TODOS OS CARGOS/.test(value);
}

export function parseEditalText(rawText: string): ParsedEdital {
  const lines = rawText.split(/\r?\n/).map(clean).filter(Boolean);
  const positions: ParsedPosition[] = [];
  const addPosition = (position: ParsedPosition) => {
    const key = normalize(position.name);
    if (!positions.some(item => normalize(item.name) === key)) positions.push(position);
  };

  for (const line of lines) {
    const found = positionFromLine(line);
    if (found) addPosition(found);
  }

  let contentStart = lines.findIndex((line, index) =>
    /ANEXO\s+[IVX]+/.test(normalize(line))
    && /CONTEUDO PROGRAMATICO|OBJETOS DE AVALIACAO/.test(normalize(lines.slice(index, index + 8).join(' ')))
  );
  if (contentStart < 0) contentStart = lines.findIndex(line => /DOS OBJETOS DE AVALIACAO/.test(normalize(line)));
  if (contentStart < 0) contentStart = lines.findIndex(line => /CONTEUDO PROGRAMATICO/.test(normalize(line)));

  const relevant = lines.slice(contentStart >= 0 ? contentStart : 0);
  const subjects: ParsedSubject[] = [];
  let activePosition: string | null = null;
  let commonMode = false;
  let currentSubject: ParsedSubject | null = null;

  const flush = () => {
    if (currentSubject && currentSubject.topics.length) subjects.push(currentSubject);
    currentSubject = null;
  };

  for (const line of relevant) {
    const normalized = normalize(line);
    const position = positionFromLine(line);
    if (position) {
      flush();
      addPosition(position);
      activePosition = position.name;
      commonMode = false;
      continue;
    }

    if (isCommonSection(line)) {
      flush();
      commonMode = true;
      activePosition = null;
      continue;
    }

    if (/^(?:[IVX]+\.\s*)?CONHECIMENTOS ESPECIFICOS\b/.test(normalized) || /^CONHECIMENTOS DO CARGO\b/.test(normalized)) {
      flush();
      commonMode = false;
      continue;
    }

    if (isSubjectHeading(line)) {
      flush();
      currentSubject = {
        name: line.replace(/^\d+(?:\.\d+)*[.)]?\s*/, '').replace(/:$/, '').trim(),
        topics: [],
        scope: commonMode || !activePosition ? 'common' : 'specific',
        positionName: commonMode ? null : activePosition,
      };
      continue;
    }

    if (currentSubject) {
      const topic = line.replace(/^[-•*]\s*/, '').trim();
      if (topic && !/^P[aá]gina\s+\d+/i.test(topic)) currentSubject.topics.push(topic);
    }
  }
  flush();

  const warnings: string[] = [];
  if (!positions.length) warnings.push('Não foi possível reconhecer automaticamente os cargos. Será necessário conferir o edital antes de salvar.');
  if (!subjects.length) warnings.push('Não foi possível separar disciplinas e tópicos com segurança. Confira o texto extraído antes de salvar.');
  if (subjects.some(subject => subject.scope === 'common') && !relevant.some(isCommonSection)) {
    warnings.push('Há conteúdos sem vínculo explícito com um cargo. Confirme se são comuns a todos ou se pertencem a uma área específica.');
  }
  return { positions, subjects, warnings };
}
