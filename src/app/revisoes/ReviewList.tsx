'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Review = { id: string; topic_id: string; scheduled_for: string; completed_at: string | null; rating: number | null; notes: string | null; topicTitle: string; subjectName: string; examTitle: string };
function dateLabel(value: string) { return new Date(value + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long' }); }

export default function ReviewList({ initialReviews }: { initialReviews: Review[] }) {
  const [reviews, setReviews] = useState(initialReviews);
  const [busy, setBusy] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [message, setMessage] = useState('');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  const pending = useMemo(() => reviews.filter(review => !review.completed_at), [reviews]);
  const due = pending.filter(review => review.scheduled_for <= todayKey);
  const upcoming = pending.filter(review => review.scheduled_for > todayKey);
  const completed = reviews.filter(review => !!review.completed_at);
  async function finish(review: Review) {
    setBusy(review.id); setMessage('');
    const supabase = createClient();
    const rating = ratings[review.id] || review.rating || 3;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMessage('Sua sessão expirou. Entre novamente.'); setBusy(null); return; }
    const completedAt = new Date().toISOString();
    const { error } = await supabase.from('reviews').update({ completed_at: completedAt, rating }).eq('id', review.id);
    if (error) setMessage('Não foi possível salvar a revisão: ' + error.message);
    else setReviews(old => old.map(item => item.id === review.id ? { ...item, completed_at: completedAt, rating } : item));
    setBusy(null);
  }
  return <div className="review-area">
    <div className="review-stats"><div><strong>{due.length}</strong><span>Para revisar agora</span></div><div><strong>{upcoming.length}</strong><span>Próximas revisões</span></div><div><strong>{completed.length}</strong><span>Concluídas</span></div></div>
    {message && <p className="message error">{message}</p>}
    <h2>Revisões pendentes</h2>
    {!pending.length && <p className="muted">Nenhuma revisão pendente. Conclua sessões de estudo para criar novas revisões automaticamente.</p>}
    {due.length > 0 && <div className="review-group"><h3>Precisam ser feitas</h3>{due.map(review => <article className="review-card" key={review.id}><div><strong>{review.topicTitle}</strong><span>{review.subjectName} · {review.examTitle}</span><small>Programada para {dateLabel(review.scheduled_for)}</small></div><div className="review-action"><label>Como foi? <select value={ratings[review.id] || 3} onChange={event => setRatings(old => ({ ...old, [review.id]: Number(event.target.value) }))}><option value={1}>1 — Muito difícil</option><option value={2}>2 — Difícil</option><option value={3}>3 — Regular</option><option value={4}>4 — Fácil</option><option value={5}>5 — Muito fácil</option></select></label><button className="btn" disabled={busy === review.id} onClick={() => finish(review)}>{busy === review.id ? 'Salvando...' : 'Concluir revisão'}</button></div></article>)}</div>}
    {upcoming.length > 0 && <div className="review-group"><h3>Agendadas</h3>{upcoming.map(review => <article className="review-card" key={review.id}><div><strong>{review.topicTitle}</strong><span>{review.subjectName} · {review.examTitle}</span><small>Revisar em {dateLabel(review.scheduled_for)}</small></div><span className="review-upcoming">Agendada</span></article>)}</div>}
    {completed.length > 0 && <details className="review-history"><summary>Histórico de revisões concluídas ({completed.length})</summary>{completed.map(review => <article className="review-card compact" key={review.id}><div><strong>{review.topicTitle}</strong><span>{review.subjectName} · {review.examTitle}</span><small>Concluída em {new Date(review.completed_at!).toLocaleDateString('pt-BR')} · Nota: {review.rating || '—'}/5</small></div></article>)}</details>}
  </div>;
}