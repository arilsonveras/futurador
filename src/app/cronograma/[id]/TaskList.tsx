'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import FullScreenLoader from '@/components/FullScreenLoader';

type Task = {
  id: string;
  topic_id: string | null;
  title: string;
  scheduled_for: string;
  starts_at: string | null;
  duration_minutes: number;
  status: string;
  notes: string | null;
};
export default function TaskList({ initialTasks, planTitle }: { initialTasks: Task[]; planTitle: string }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const completed = tasks.filter(task => task.status === 'completed').length;
  const grouped = tasks.reduce<Record<string, Task[]>>((result, task) => {
    (result[task.scheduled_for] ||= []).push(task);
    return result;
  }, {});

  async function toggle(task: Task) {
    setBusy(task.id);
    setNotice('');
    const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
    const supabase = createClient();
    const { error } = await supabase.from('study_tasks').update({ status: nextStatus }).eq('id', task.id);
    if (error) { setNotice('Não foi possível atualizar a sessão: ' + error.message); setBusy(null); return; }
    setTasks(old => old.map(item => item.id === task.id ? { ...item, status: nextStatus } : item));
    if (nextStatus === 'completed' && task.topic_id) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const base = new Date(); base.setHours(12, 0, 0, 0);
        const dates = [1, 7, 30].map(offset => { const date = new Date(base); date.setDate(date.getDate() + offset); return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); });
        const { data: existing, error: lookupError } = await supabase.from('reviews').select('scheduled_for').eq('topic_id', task.topic_id).in('scheduled_for', dates);
        if (lookupError) setNotice('Sessão concluída, mas não foi possível programar as revisões: ' + lookupError.message);
        else {
          const existingDates = new Set((existing || []).map(item => item.scheduled_for));
          const rows = dates.filter(date => !existingDates.has(date)).map(date => ({ user_id: user.id, topic_id: task.topic_id, scheduled_for: date }));
          if (rows.length) { const { error: reviewError } = await supabase.from('reviews').insert(rows); if (reviewError) setNotice('Sessão concluída, mas houve um problema ao programar as revisões: ' + reviewError.message); else setNotice('Sessão concluída! Revisões programadas para 1, 7 e 30 dias.'); }
          else setNotice('Sessão concluída! As revisões deste tópico já estavam programadas.');
        }
      }
    }
    setBusy(null);
  }

  return (
    <main className="wrap">
      {busy && <FullScreenLoader mode="plan" />}
      <nav className="nav"><Link className="brand" href="/">futurador.</Link><Link href="/painel">Voltar ao painel</Link></nav>
      <section className="panel">
        <h1>{planTitle}</h1>
        <p className="muted">Acompanhe suas sessões e marque cada tópico quando concluir. O Futurador programará revisões espaçadas automaticamente.</p>
        {notice && <p className="message">{notice}</p>}
        <p><Link className="btn alt" href="/revisoes">Ver minhas revisões</Link></p>
        <div className="progress-wrap">
          <div className="progress-label"><strong>{completed} de {tasks.length} sessões concluídas</strong><span>{tasks.length ? Math.round(completed / tasks.length * 100) : 0}%</span></div>
          <div className="progress-track"><div className="progress-fill" style={{ width: (tasks.length ? completed / tasks.length * 100 : 0) + '%' }} /></div>
        </div>
        {Object.entries(grouped).map(([date, items]) => (
          <section className="task-day" key={date}>
            <h2>{new Date(date + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</h2>
            <div className="task-list">
              {items.map(task => (
                <article className={'task-card' + (task.status === 'completed' ? ' task-done' : '')} key={task.id}>
                  <div className="task-info">
                    <strong>{task.title}</strong>
                    {task.notes && <span className="muted">{task.notes}</span>}
                    <span className="muted">{task.starts_at ? task.starts_at.slice(0, 5) + ' · ' : ''}{task.duration_minutes} minutos</span>
                  </div>
                  <button className={task.status === 'completed' ? 'btn alt' : 'btn'} type="button" disabled={busy === task.id} onClick={() => toggle(task)}>
                    {busy === task.id ? 'Salvando...' : task.status === 'completed' ? 'Desfazer' : 'Concluir'}
                  </button>
                </article>
              ))}
            </div>
          </section>
        ))}
        {!tasks.length && <p className="muted">Este cronograma ainda não possui sessões.</p>}
      </section>
    </main>
  );
}
