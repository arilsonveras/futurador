import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import PlannerSetup from './PlannerSetup';

export const dynamic = 'force-dynamic';

export default async function PlanejarEdital({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: exam, error } = await supabase.from('exams')
    .select('id,title,exam_date').eq('id', id).single();
  if (error || !exam) notFound();

  const { data: subjects } = await supabase.from('subjects')
    .select('id,name,sort_order,position_id,scope_type').eq('exam_id', id).order('sort_order');
  const { data: positions } = await supabase.from('exam_positions').select('id,name,code,sort_order').eq('exam_id', id).order('sort_order');
  const subjectIds = (subjects || []).map(subject => subject.id);
  const { data: topicRows } = subjectIds.length
    ? await supabase.from('topics').select('id,title,subject_id,sort_order').in('subject_id', subjectIds).order('sort_order')
    : { data: [] };
  const subjectNames = new Map((subjects || []).map(subject => [subject.id, subject.name]));
  const topics = (topicRows || []).map(topic => ({
    id: topic.id,
    title: topic.title,
    subjectName: subjectNames.get(topic.subject_id) || 'Disciplina',
    positionId: (subjects || []).find(subject => subject.id === topic.subject_id)?.position_id || null,
    scopeType: (subjects || []).find(subject => subject.id === topic.subject_id)?.scope_type || 'unassigned',
  }));

  const { data: availability } = await supabase.from('study_availability')
    .select('weekday,start_time,end_time').order('weekday');
  const { data: plans } = await supabase.from('study_plans')
    .select('id,position_id').eq('exam_id', id).eq('status', 'active').order('created_at', { ascending: false }).limit(1);

  return (
    <PlannerSetup
      examId={exam.id}
      examTitle={exam.title}
      examDate={exam.exam_date}
      topics={topics}
      positions={positions || []}
      initialAvailability={availability || []}
      existingPlanId={plans?.find(plan => plan.position_id === (positions?.[0]?.id || null))?.id || null}
    />
  );
}
