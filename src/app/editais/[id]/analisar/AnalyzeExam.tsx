'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.js';

// PDF.js 3.11 precisa de um worker explícito no deploy da Vercel.
// O CDN corresponde exatamente à versão instalada em package.json.
GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

type Props = {
  examId: string;
  filePath: string;
  examTitle: string;
  alreadyHasSubjects: boolean;
};
type OutlineSubject = { name: string; topics: string[] };

function cleanLine(value: string) {
  return value.replace(/\s+/g, ' ').replace(/^[-•▪◦]+\s*/, '').trim();
}

function makeOutline(raw: string) {
  const lines = raw.split(/\r?\n/).map(cleanLine).filter(line => line.length > 2 && !/^\d{1,4}$/.test(line));
  const headingPattern = /^(?:\d+(?:\.\d+)*[.)]?\s*)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9][A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9 /(),.:;–—-]{2,}$/;
  let output = '';
  let current = '';
  for (const line of lines) {
    if (line.length < 100 && headingPattern.test(line) && /[A-ZÁÉÍÓÚÂÊÔÃÕÇ]/.test(line)) {
      current = line.replace(/^\d+(?:\.\d+)*[.)]?\s*/, '').trim();
      output += (output ? '\n\n' : '') + 'DISCIPLINA: ' + current + '\n';
    } else if (current) {
      output += '- ' + line + '\n';
    } else {
      if (!output) output = 'DISCIPLINA: Conteúdo do edital — classificar\n';
      output += '- ' + line + '\n';
    }
  }
  return output.trim();
}

function parseOutline(value: string): OutlineSubject[] {
  const result: OutlineSubject[] = [];
  let current: OutlineSubject | null = null;
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^DISCIPLINA\s*:/i.test(line)) {
      if (current) result.push(current);
      current = { name: line.replace(/^DISCIPLINA\s*:/i, '').trim(), topics: [] };
      continue;
    }
    if (!current) current = { name: 'Conteúdo do edital', topics: [] };
    const topic = line.replace(/^[-•*]\s*/, '').trim();
    if (topic && topic !== '[inclua os tópicos...]') current.topics.push(topic);
  }
  if (current) result.push(current);
  return result.filter(subject => subject.name && subject.topics.length > 0);
}

export default function AnalyzeExam({ examId, filePath, examTitle, alreadyHasSubjects }: Props) {
  const [outline, setOutline] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const started = useRef(false);

  async function persistOutline(value: string) {
    const parsed = parseOutline(value);
    if (!parsed.length) {
      setMessage('O texto foi extraído, mas não consegui separar disciplinas e tópicos com segurança. Você pode ajustar a organização abaixo e salvar.');
      return false;
    }

    setBusy(true);
    const supabase = createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      setMessage('Sua sessão expirou. Entre novamente para salvar a análise.');
      setBusy(false);
      return false;
    }

    for (let i = 0; i < parsed.length; i++) {
      const subject = parsed[i];
      const { data: inserted, error: subjectError } = await supabase
        .from('subjects')
        .insert({ user_id: user.id, exam_id: examId, name: subject.name, sort_order: i })
        .select('id')
        .single();
      if (subjectError || !inserted) {
        setMessage('Erro ao salvar disciplina: ' + (subjectError?.message || 'registro não retornado'));
        setBusy(false);
        return false;
      }
      const topics = subject.topics.map((title, index) => ({
        user_id: user.id,
        subject_id: inserted.id,
        title,
        sort_order: index,
      }));
      const { error: topicsError } = await supabase.from('topics').insert(topics);
      if (topicsError) {
        setMessage('A disciplina foi salva, mas houve erro ao salvar seus tópicos: ' + topicsError.message);
        setBusy(false);
        return false;
      }
    }

    setMessage('Análise concluída! Disciplinas e tópicos foram salvos automaticamente.');
    setBusy(false);
    return true;
  }

  async function extractPdf() {
    if (alreadyHasSubjects) {
      setMessage('Este edital já possui disciplinas cadastradas. Para preservar seu progresso, a análise automática não será repetida.');
      return;
    }
    setExtracting(true);
    setMessage('Baixando o edital e iniciando a análise automática...');
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage.from('edital-pdfs').download(filePath);
      if (error || !data) throw new Error(error?.message || 'Não foi possível baixar o PDF.');
      const bytes = new Uint8Array(await data.arrayBuffer());
      const pdf = await getDocument({ data: bytes, isEvalSupported: false }).promise;
      let text = '';
      const maxPages = Math.min(pdf.numPages, 250);
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
        if (text.length >= 50000) break;
      }
      if (!text.trim()) {
        setMessage('O PDF não contém texto selecionável. Este arquivo parece digitalizado como imagem e precisa de OCR; nenhum dado foi salvo.');
        return;
      }
      const generated = makeOutline(text.slice(0, 50000));
      setOutline(generated);
      await persistOutline(generated);
    } catch (error) {
      setMessage('Falha ao analisar o PDF: ' + (error instanceof Error ? error.message : 'erro desconhecido'));
    } finally {
      setExtracting(false);
    }
  }

  async function saveManualChanges() {
    if (alreadyHasSubjects) {
      setMessage('Este edital já possui disciplinas cadastradas. Não vamos duplicar os dados.');
      return;
    }
    await persistOutline(outline);
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void extractPdf();
  }, []);

  return (
    <main className="wrap">
      <nav className="nav">
        <Link className="brand" href="/">futurador.</Link>
        <Link href="/painel">Voltar ao painel</Link>
      </nav>
      <section className="panel">
        <h1>Análise automática do edital</h1>
        <p className="muted">{examTitle}</p>
        {extracting && <p className="message">Estamos lendo o PDF e identificando disciplinas e assuntos. Aguarde nesta página.</p>}
        {alreadyHasSubjects && <p className="message">Este edital já possui disciplinas. Os dados existentes foram preservados.</p>}
        {outline && (
          <div className="field">
            <label htmlFor="outline">Conteúdo identificado (pode revisar antes de salvar novamente se a análise não foi concluída)</label>
            <textarea id="outline" value={outline} onChange={e => setOutline(e.target.value)} />
          </div>
        )}
        {message && <p className="message">{message}</p>}
        {!extracting && !alreadyHasSubjects && outline && !message.startsWith('Análise concluída') && (
          <button className="btn" type="button" onClick={saveManualChanges} disabled={busy}>
            {busy ? 'Salvando...' : 'Salvar disciplinas e tópicos'}
          </button>
        )}
        <Link className="btn secondary" href="/painel">Ir para o painel</Link>
      </section>
    </main>
  );
}
