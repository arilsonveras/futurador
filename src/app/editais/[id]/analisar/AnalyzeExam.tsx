'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.js';
import { parseEditalText, type ParsedEdital } from '@/lib/edital-parser';

GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

type Props = { examId: string; filePath: string; examTitle: string; alreadyHasSubjects: boolean };

function key(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export default function AnalyzeExam({ examId, filePath, examTitle, alreadyHasSubjects }: Props) {
  const [result, setResult] = useState<ParsedEdital | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saved, setSaved] = useState(alreadyHasSubjects);
  const started = useRef(false);

  async function extractPdf() {
    setExtracting(true);
    setMessage('Lendo o edital completo e procurando cargos, anexos e conteúdos programáticos...');
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage.from('edital-pdfs').download(filePath);
      if (error || !data) throw new Error(error?.message || 'Não foi possível baixar o PDF.');
      const bytes = new Uint8Array(await data.arrayBuffer());
      const pdf = await getDocument({ data: bytes, isEvalSupported: false }).promise;
      let text = '';
      const maxPages = Math.min(pdf.numPages, 350);
      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const items = content.items as Array<{ str?: string; transform?: number[] }>;
        let pageText = '';
        let previousY: number | null = null;
        for (const item of items) {
          const value = item.str || '';
          if (!value.trim()) continue;
          const y = item.transform?.[5];
          if (previousY !== null && typeof y === 'number' && Math.abs(y - previousY) > 2) {
            pageText += '\n';
          } else if (pageText && !pageText.endsWith('\n')) {
            pageText += ' ';
          }
          pageText += value;
          if (typeof y === 'number') previousY = y;
        }
        text += pageText + '\n';
      }
      if (!text.trim()) throw new Error('O PDF não contém texto selecionável. Este arquivo precisa de OCR.');
      const parsed = parseEditalText(text);
      setResult(parsed);
      setMessage(parsed.subjects.length
        ? 'Leitura concluída. Confira a separação por cargo antes de salvar.'
        : 'O texto foi extraído, mas a estrutura do conteúdo programático não foi reconhecida com segurança.');
    } catch (error) {
      setMessage('Falha ao analisar o PDF: ' + (error instanceof Error ? error.message : 'erro desconhecido'));
    } finally {
      setExtracting(false);
    }
  }

  async function saveStructure() {
    if (!result || !result.positions.length || !result.subjects.length) {
      setMessage('Não há cargos e conteúdos suficientes para salvar com segurança.');
      return;
    }
    setBusy(true);
    setMessage('');
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      setMessage('Sua sessão expirou. Entre novamente.');
      setBusy(false);
      return;
    }

    const { data: insertedPositions, error: positionError } = await supabase
      .from('exam_positions')
      .insert(result.positions.map((position, index) => ({
        user_id: user.id, exam_id: examId, name: position.name, code: position.code, sort_order: index,
      })))
      .select('id,name');
    if (positionError || !insertedPositions?.length) {
      setMessage('Não foi possível salvar os cargos: ' + (positionError?.message || 'nenhum cargo retornado'));
      setBusy(false);
      return;
    }

    const positionMap = new Map(insertedPositions.map(position => [key(position.name), position.id]));
    let savedSubjects = 0;
    for (let index = 0; index < result.subjects.length; index++) {
      const subject = result.subjects[index];
      const positionId = subject.scope === 'common' ? null : positionMap.get(key(subject.positionName || ''));
      if (subject.scope === 'specific' && !positionId) continue;
      const { data: inserted, error: subjectError } = await supabase.from('subjects').insert({
        user_id: user.id,
        exam_id: examId,
        name: subject.name,
        sort_order: index,
        position_id: positionId,
        scope_type: subject.scope,
      }).select('id').single();
      if (subjectError || !inserted) {
        setMessage('Erro ao salvar a disciplina ' + subject.name + ': ' + (subjectError?.message || 'registro não retornado'));
        setBusy(false);
        return;
      }
      const topicRows = subject.topics.map((title, topicIndex) => ({
        user_id: user.id, subject_id: inserted.id, title, sort_order: topicIndex,
      }));
      if (topicRows.length) {
        const { error: topicError } = await supabase.from('topics').insert(topicRows);
        if (topicError) {
          setMessage('A disciplina foi salva, mas houve erro ao salvar tópicos: ' + topicError.message);
          setBusy(false);
          return;
        }
      }
      savedSubjects++;
    }

    setSaved(true);
    setMessage('Estrutura salva: ' + insertedPositions.length + ' cargo(s) e ' + savedSubjects + ' disciplina(s). Confira os vínculos antes de montar o cronograma.');
    setBusy(false);
  }

  useEffect(() => {
    if (started.current || alreadyHasSubjects) return;
    started.current = true;
    void extractPdf();
  }, []);

  const counts = result?.positions.map(position => ({
    ...position,
    subjects: result.subjects.filter(subject => subject.scope === 'specific' && key(subject.positionName || '') === key(position.name)),
  })) || [];
  const commonCount = result?.subjects.filter(subject => subject.scope === 'common').length || 0;

  return (
    <main className="wrap">
      <nav className="nav"><Link className="brand" href="/">futurador.</Link><Link href="/painel">Voltar ao painel</Link></nav>
      <section className="panel">
        <h1>Análise estruturada do edital</h1>
        <p className="muted">{examTitle}</p>
        {alreadyHasSubjects && <p className="message">Este edital já possui disciplinas cadastradas. Os dados existentes foram preservados para não apagar seu progresso. A reclassificação desses registros será uma etapa própria.</p>}
        {extracting && <p className="message">{message}</p>}
        {result && (
          <>
            <h2>Cargos identificados ({result.positions.length})</h2>
            {counts.map((position, index) => (
              <div className="availability-day" key={position.name}>
                <strong>{position.code ? position.code + ' — ' : ''}{position.name}</strong>
                <span>{position.subjects.length} disciplina(s) específicas</span>
              </div>
            ))}
            <p className="muted">{commonCount} disciplina(s) foram identificadas como conteúdo comum. Elas serão compartilhadas entre os cargos.</p>
            <h2>Disciplinas encontradas</h2>
            {result.subjects.map((subject, index) => (
              <div className="availability-day" key={subject.name + index}>
                <strong>{subject.name}</strong>
                <span>{subject.topics.length} tópico(s) · {subject.scope === 'common' ? 'Comum aos cargos' : subject.positionName || 'Cargo não vinculado'}</span>
              </div>
            ))}
            {result.warnings.map((warning, index) => <p className="message error" key={index}>{warning}</p>)}
            {!saved && <button className="btn" type="button" onClick={saveStructure} disabled={busy || !result.positions.length || !result.subjects.length}>{busy ? 'Salvando estrutura...' : 'Confirmar cargos, disciplinas e tópicos'}</button>}
          </>
        )}
        {message && !extracting && <p className="message">{message}</p>}
        {!result && !extracting && !alreadyHasSubjects && <button className="btn" type="button" onClick={extractPdf}>Analisar edital novamente</button>}
        {saved && <Link className="btn" href={'/editais/' + examId + '/planejar'}>Continuar para montar cronograma</Link>}
        <Link className="btn secondary" href="/painel">Ir para o painel</Link>
      </section>
    </main>
  );
}
