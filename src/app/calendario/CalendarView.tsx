'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

type CalendarTask = {
  id: string;
  planId: string;
  planTitle: string;
  title: string;
  scheduledFor: string;
  startsAt: string | null;
  durationMinutes: number;
  status: string;
  notes: string | null;
};

function keyOf(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function monthLabel(date: Date) {
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export default function CalendarView({ tasks }: { tasks: CalendarTask[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(keyOf(today));
  const grouped = useMemo(() => tasks.reduce<Record<string, CalendarTask[]>>((result, task) => {
    (result[task.scheduledFor] ||= []).push(task);
    return result;
  }, {}), [tasks]);

  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(firstDay);
  gridStart.setDate(1 - firstDay.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
  const selectedTasks = grouped[selectedDate] || [];
  const pending = tasks.filter(task => task.status !== 'completed').length;
  const completed = tasks.length - pending;

  function moveMonth(offset: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    setMonth(next);
    setSelectedDate(keyOf(next));
  }

  return (
    <section className="panel calendar-shell">
      <div className="calendar-toolbar">
        <div>
          <h2>{monthLabel(month)}</h2>
          <p className="muted">{tasks.length} sessões no cronograma · {pending} pendentes · {completed} concluídas</p>
        </div>
        <div className="calendar-nav">
          <button type="button" onClick={() => moveMonth(-1)} aria-label="Mês anterior">←</button>
          <button type="button" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(keyOf(today)); }}>Hoje</button>
          <button type="button" onClick={() => moveMonth(1)} aria-label="Próximo mês">→</button>
        </div>
      </div>
      <div className="calendar-grid" role="grid" aria-label="Calendário mensal de estudos">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => <div className="calendar-weekday" role="columnheader" key={day}>{day}</div>)}
        {days.map(date => {
          const dateKey = keyOf(date);
          const dayTasks = grouped[dateKey] || [];
          const outside = date.getMonth() !== month.getMonth();
          const isToday = dateKey === keyOf(today);
          return (
            <button
              type="button"
              role="gridcell"
              aria-label={date.toLocaleDateString('pt-BR') + ', ' + dayTasks.length + ' tarefas'}
              aria-pressed={selectedDate === dateKey}
              key={dateKey}
              onClick={() => setSelectedDate(dateKey)}
              className={'calendar-day' + (outside ? ' outside' : '') + (isToday ? ' today' : '') + (selectedDate === dateKey ? ' selected' : '')}
            >
              <span className="calendar-day-number">{date.getDate()}</span>
              {dayTasks.length > 0 && <>
                <span className="calendar-day-dots">{dayTasks.slice(0, 5).map(task => <i key={task.id} className={task.status === 'completed' ? 'done' : ''} />)}</span>
                <span className="calendar-day-count">{dayTasks.length} {dayTasks.length === 1 ? 'tarefa' : 'tarefas'}</span>
              </>}
            </button>
          );
        })}
      </div>
      <div className="calendar-legend">
        <span><i /> Tarefa pendente</span>
        <span><i className="done" /> Tarefa concluída</span>
      </div>
      <div className="calendar-selected">
        <h3>{new Date(selectedDate + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
        {selectedTasks.length ? selectedTasks.map(task => (
          <article className="calendar-task" key={task.id}>
            <div className="calendar-task-main">
              <strong>{task.title}</strong>
              <small>{task.startsAt ? task.startsAt.slice(0, 5) + ' · ' : ''}{task.durationMinutes} min · {task.notes || task.planTitle}</small>
              <small>{task.planTitle}</small>
            </div>
            <div>
              <span className={'calendar-task-status' + (task.status === 'completed' ? ' done' : '')}>{task.status === 'completed' ? 'Concluída' : 'Pendente'}</span>
              <div><Link href={'/cronograma/' + task.planId}>Abrir cronograma →</Link></div>
            </div>
          </article>
        )) : <p className="calendar-empty">Nenhuma tarefa programada para este dia. Escolha outra data ou confira seus cronogramas.</p>}
      </div>
      {!tasks.length && <p className="calendar-empty">Você ainda não tem sessões de estudo cadastradas. Monte seu primeiro cronograma para preencher o calendário.</p>}
    </section>
  );
}
