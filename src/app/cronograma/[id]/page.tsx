import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import TaskList from './TaskList';

export const dynamic = 'force-dynamic';

export default async function CronogramaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: plan, error } = await supabase.from('study_plans')
    .select('id,title').eq('id', id).single();
  if (error || !plan) notFound();

  const { data: tasks } = await supabase.from('study_tasks')
    .select('id,topic_id,title,scheduled_for,starts_at,duration_minutes,status,notes')
    .eq('plan_id', id)
    .order('scheduled_for', { ascending: true })
    .order('starts_at', { ascending: true });

  return <TaskList initialTasks={tasks || []} planTitle={plan.title} />;
}
