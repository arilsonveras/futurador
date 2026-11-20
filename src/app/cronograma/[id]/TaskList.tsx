'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Task = {
  id: string;
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
  const completed = tasks.filter(task => task.status === 'completed').length;
  const grouped = tasks.reduce<Record<string, Task[]>>((result, task) => {
    (result[task.scheduled_for] ||= []).push(task);
    return result;
  }, {});

  async function toggle(task: Task) {
    setBusy(task.id);
    const nextStatus = task.status === 'completed' ? 'pending' : 'completed';
    const supabase = createClient();
    const { error } = await supabase.from('study_tasks').update({ status: nextStatus }).eq('id', task.id);
    if (!error) setTasks(old => old.map(item => item.id === task.id ? { ...item, status: nextStatus } : item));
    setBusy(null);
  }

  return (
    <main className="wrap">
      <nav className="nav"><Link className="brand" href="/">futurador.</Link><Link href="/painel">Voltar ao painel</Link></nav>
      <section className="panel">
        <h1>{planTitle}</h1>
        <p className="muted">Acompanhe suas sessões e marque cada tópico quando concluir.</p>
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
