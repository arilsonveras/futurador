'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function NovoEdital() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [institution, setInstitution] = useState('');
  const [examDate, setExamDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage('');
    if (!file) { setMessage('Selecione o PDF do edital.'); return; }
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setMessage('O arquivo precisa estar no formato PDF.'); return;
    }
    if (file.size > 20 * 1024 * 1024) { setMessage('O PDF deve ter no máximo 20 MB.'); return; }

    setBusy(true);
    const supabase = createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      setMessage('Sua sessão expirou. Entre novamente.');
      setBusy(false);
      router.push('/login');
      return;
    }

    const path = `${user.id}/${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await supabase.storage.from('edital-pdfs').upload(path, file, {
      contentType: 'application/pdf',
      upsert: false,
    });
    if (uploadError) {
      setMessage('Falha ao enviar PDF: ' + uploadError.message);
      setBusy(false);
      return;
    }

    const { error: insertError } = await supabase.from('exams').insert({
      user_id: user.id,
      title,
      institution: institution || null,
      exam_date: examDate || null,
      edital_file_path: path,
      status: 'active',
    });
    if (insertError) {
      await supabase.storage.from('edital-pdfs').remove([path]);
      setMessage('Não foi possível salvar o edital: ' + insertError.message);
      setBusy(false);
      return;
    }

    router.push('/painel');
    router.refresh();
  }

  return (
    <main className="wrap">
      <nav className="nav">
        <Link className="brand" href="/">futurador.</Link>
        <Link href="/painel">Voltar ao painel</Link>
      </nav>
      <form className="form" onSubmit={submit}>
        <h1>Novo edital</h1>
        <p className="muted">Cadastre as informações do concurso e envie o edital em PDF.</p>
        <div className="field">
          <label htmlFor="title">Nome do concurso</label>
          <input id="title" required value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Concurso da Polícia Militar" />
        </div>
        <div className="field">
          <label htmlFor="institution">Órgão ou instituição</label>
          <input id="institution" value={institution} onChange={e => setInstitution(e.target.value)} placeholder="Ex.: Polícia Militar" />
        </div>
        <div className="field">
          <label htmlFor="examDate">Data da prova (opcional)</label>
          <input id="examDate" type="date" value={examDate} onChange={e => setExamDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pdf">Arquivo do edital (PDF, até 20 MB)</label>
          <input id="pdf" type="file" accept="application/pdf,.pdf" required onChange={e => setFile(e.target.files?.[0] || null)} />
        </div>
        {message && <p className="message error">{message}</p>}
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Enviando edital...' : 'Salvar edital'}</button>
      </form>
    </main>
  );
}
