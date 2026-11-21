import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import CalendarView from './CalendarView';

export const dynamic = 'force-dynamic';

export default async function CalendarioPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: plans } = await supabase.from('study_plans')
    .select('id,title')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  const planIds = (plans || []).map(plan => plan.id);
  const { data: tasks } = planIds.length
    ? await supabase.from('study_tasks')
        .select('id,plan_id,title,scheduled_for,starts_at,duration_minutes,status,notes')
        .in('plan_id', planIds)
        .order('scheduled_for', { ascending: true })
        .order('starts_at', { ascending: true })
        .limit(1500)
    : { data: [] };
  const planNames = new Map((plans || []).map(plan => [plan.id, plan.title]));
  const calendarTasks = (tasks || []).map(task => ({
    id: task.id,
    planId: task.plan_id,
    planTitle: planNames.get(task.plan_id) || 'Cronograma de estudos',
    title: task.title,
    scheduledFor: task.scheduled_for,
    startsAt: task.starts_at,
    durationMinutes: task.duration_minutes,
    status: task.status,
    notes: task.notes,
  }));

  return (
    <main className="wrap">
      <nav className="nav">
        <Link className="brand" href="/">futurador.</Link>
        <div className="calendar-nav">
          <Link className="btn alt" href="/painel">Meu painel</Link>
          <Link className="btn" href="/">Encontrar concurso</Link>
        </div>
      </nav>
      <div className="dashboard-heading">
        <div><h1>Meu calendário de estudos</h1><p className="muted">Veja o que estudar em cada dia e acompanhe seu avanço.</p></div>
      </div>
      <CalendarView tasks={calendarTasks} />
    </main>
  );
}
