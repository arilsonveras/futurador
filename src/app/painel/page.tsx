import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ExamList from './ExamList';
export const dynamic='force-dynamic';
export default async function Painel(){
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect('/login');
 const {data:exams}=await supabase.from('exams').select('id,title,institution,exam_date,status,edital_file_path').order('created_at',{ascending:false});
 const {data:tasks}=await supabase.from('study_tasks').select('id,title,status,scheduled_for').order('scheduled_for',{ascending:true}).limit(5);
 const today=new Date();today.setHours(0,0,0,0);const todayKey=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
 const {count:reviewCount}=await supabase.from('reviews').select('id',{count:'exact',head:true}).is('completed_at',null).lte('scheduled_for',todayKey);
 return <main className="wrap"><nav className="nav"><Link className="brand" href="/">futurador.</Link><form action="/auth/logout" method="post"><button className="btn alt" type="submit">Sair</button></form></nav><h1>Seu painel de estudos</h1><p className="muted">Bem-vindo(a), {user.user_metadata?.full_name||user.email}. Continue sua preparação.</p><section className="grid stats-grid"><article className="panel"><span className="muted">Concursos cadastrados</span><div className="stat">{exams?.length||0}</div></article><article className="panel"><span className="muted">Tarefas encontradas</span><div className="stat">{tasks?.length||0}</div></article><article className="panel"><span className="muted">Revisões para hoje</span><div className="stat">{reviewCount||0}</div><Link className="btn alt" href="/revisoes">Abrir revisões</Link></article></section><ExamList initialExams={exams||[]}/></main>;
}