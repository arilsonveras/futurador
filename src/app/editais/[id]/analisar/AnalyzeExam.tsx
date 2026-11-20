'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.js';

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

  async function extractPdf() {
    setExtracting(true);
    setMessage('');
    try {
      const supabase = createClient();
      const { data, error } = await supabase.storage.from('edital-pdfs').download(filePath);
      if (error || !data) throw new Error(error?.message || 'Não foi possível baixar o PDF.');
      const bytes = new Uint8Array(await data.arrayBuffer());
      const pdf = await getDocument({ data: bytes, disableWorker: true, isEvalSupported: false }).promise;
      let text = '';
      const maxPages = Math.min(pdf.numPages, 250);
      for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const line = content.items
          .map((item: { str?: string }) => item.str || '')
          .filter(Boolean)
          .join(' ');
        text += line + '\n';
        if (text.length >= 50000) break;
      }
      if (!text.trim()) {
        setMessage('Não foi possível encontrar texto neste PDF. Se ele for digitalizado como imagem, será necessário OCR.');
      } else {
        setOutline(makeOutline(text.slice(0, 50000)));
        setMessage('Texto extraído. Revise as disciplinas e os tópicos antes de salvar.');
      }
    } catch (error) {
      setMessage('Falha ao ler o PDF: ' + (error instanceof Error ? error.message : 'erro desconhecido'));
    } finally {
      setExtracting(false);
    }
  }

  async function saveOutline() {
    if (alreadyHasSubjects) {
      setMessage('Este edital já possui disciplinas cadastradas. Para preservar seu progresso, não vamos duplicá-las.');
      return;
    }
    const parsed = parseOutline(outline);
    if (!parsed.length) {
      setMessage('Não encontrei disciplinas com tópicos. Use o formato DISCIPLINA: Nome e inclua os tópicos em linhas abaixo.');
      return;
    }
    setBusy(true);
    setMessage('');
    const supabase = createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      setMessage('Sua sessão expirou. Entre novamente.');
      setBusy(false);
      return;
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
        return;
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
        return;
      }
    }
    setMessage('Disciplinas e tópicos salvos com sucesso.');
    setBusy(false);
    window.location.href = '/painel';
  }

  return (
    <main className="wrap">
      <nav className="nav">
        <Link className="brand" href="/">futurador.</Link>
        <Link href="/painel">Voltar ao painel</Link>
      </nav>
      <section className="panel">
        <h1>Analisar edital</h1>
        <p className="muted">{examTitle}</p>
        {alreadyHasSubjects && <p className="message">Este edital já possui disciplinas. A análise não irá sobrescrever os dados existentes.</p>}
        <button className="btn" type="button" onClick={extractPdf} disabled={extracting}>
          {extracting ? 'Lendo PDF...' : 'Extrair texto do PDF'}
        </button>
        <p className="muted outline-help">A extração funciona em PDFs com texto selecionável. Arquivos digitalizados como imagem precisam de OCR.</p>
        <div className="field">
          <label htmlFor="outline">Revise e organize o conteúdo</label>
          <textarea id="outline" value={outline} onChange={e => setOutline(e.target.value)} placeholder={'DISCIPLINA: Língua Portuguesa\n- Interpretação de textos\n- Ortografia'} />
        </div>
        {message && <p className="message">{message}</p>}
        <button className="btn" type="button" onClick={saveOutline} disabled={busy || alreadyHasSubjects}>
          {busy ? 'Salvando...' : 'Salvar disciplinas e tópicos'}
        </button>
      </section>
    </main>
  );
}
