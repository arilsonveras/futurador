'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Exam = {
  id: string;
  title: string;
  institution: string | null;
  exam_date: string | null;
  status: string | null;
  edital_file_path: string | null;
};

export default function ExamList({ initialExams }: { initialExams: Exam[] }) {
  const [exams, setExams] = useState(initialExams);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function remove(exam: Exam) {
    if (!window.confirm(`Excluir o edital "${exam.title}"? Essa ação não pode ser desfeita.`)) return;
    setBusy(exam.id);
    setMessage('');
    const supabase = createClient();

    const { error: deleteError } = await supabase.from('exams').delete().eq('id', exam.id);
    if (deleteError) {
      setMessage('Não foi possível excluir: ' + deleteError.message);
      setBusy(null);
      return;
    }

    if (exam.edital_file_path) {
      const { error: storageError } = await supabase.storage.from('edital-pdfs').remove([exam.edital_file_path]);
      if (storageError) {
        setMessage('O edital foi excluído, mas não foi possível remover o PDF: ' + storageError.message);
      }
    }
    setExams(old => old.filter(item => item.id !== exam.id));
    setBusy(null);
  }

  return (
    <section className="exam-section">
      <div className="row">
        <h2>Seus editais</h2>
        <Link className="btn" href="/editais/novo">+ Adicionar edital</Link>
      </div>
      {message && <p className="message error">{message}</p>}
      {exams.length === 0 ? (
        <div className="panel">
          <p className="muted">Você ainda não cadastrou nenhum edital.</p>
          <Link className="btn" href="/editais/novo">Cadastrar meu primeiro edital</Link>
        </div>
      ) : (
        <div className="exam-list">
          {exams.map(exam => (
            <article className="exam panel" key={exam.id}>
              <div>
                <h3>{exam.title}</h3>
                <p className="muted">{exam.institution || 'Instituição não informada'}{exam.exam_date ? ` · Prova: ${new Date(exam.exam_date + 'T00:00:00').toLocaleDateString('pt-BR')}` : ''}</p>
              </div>
              <div className="exam-actions">
                <Link className="btn" href={`/editais/${exam.id}/analisar`}>Analisar edital</Link>
                <button className="btn danger" type="button" disabled={busy === exam.id} onClick={() => remove(exam)}>
                  {busy === exam.id ? 'Excluindo...' : 'Excluir'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
