import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ReviewList from './ReviewList';

export const dynamic = 'force-dynamic';

export default async function RevisoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: reviews } = await supabase.from('reviews').select('id,topic_id,scheduled_for,completed_at,rating,notes').order('scheduled_for', { ascending: true }).limit(300);
  const topicIds = [...new Set((reviews || []).map(review => review.topic_id))];
  const { data: topics } = topicIds.length ? await supabase.from('topics').select('id,title,subject_id').in('id', topicIds) : { data: [] };
  const subjectIds = [...new Set((topics || []).map(topic => topic.subject_id))];
  const { data: subjects } = subjectIds.length ? await supabase.from('subjects').select('id,name,exam_id').in('id', subjectIds) : { data: [] };
  const examIds = [...new Set((subjects || []).map(subject => subject.exam_id))];
  const { data: exams } = examIds.length ? await supabase.from('exams').select('id,title').in('id', examIds) : { data: [] };
  const topicMap = new Map((topics || []).map(topic => [topic.id, topic]));
  const subjectMap = new Map((subjects || []).map(subject => [subject.id, subject]));
  const examMap = new Map((exams || []).map(exam => [exam.id, exam]));
  const items = (reviews || []).map(review => {
    const topic = topicMap.get(review.topic_id);
    const subject = topic ? subjectMap.get(topic.subject_id) : null;
    const exam = subject ? examMap.get(subject.exam_id) : null;
    return { ...review, topicTitle: topic?.title || 'Tópico de estudo', subjectName: subject?.name || 'Disciplina', examTitle: exam?.title || 'Concurso' };
  });
  return <main className="wrap"><nav className="nav"><Link className="brand" href="/">futurador.</Link><Link href="/painel">Voltar ao painel</Link></nav><section className="panel"><h1>Revisões espaçadas</h1><p className="muted">Revise os tópicos nos intervalos programados para fortalecer a memorização. As revisões são criadas quando você conclui uma sessão de estudo.</p><ReviewList initialReviews={items} /></section></main>;
}