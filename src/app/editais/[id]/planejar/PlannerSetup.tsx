'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

type Availability = { weekday: number; start_time: string; end_time: string };
type Topic = { id: string; title: string; subjectName: string };
type Props = {
  examId: string;
  examTitle: string;
  examDate: string | null;
  topics: Topic[];
  initialAvailability: Availability[];
  existingPlanId: string | null;
};
const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function minutes(value: string) {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}
function dateKey(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export default function PlannerSetup({ examId, examTitle, examDate, topics, initialAvailability, existingPlanId }: Props) {
  const [availability, setAvailability] = useState<Record<number, { enabled: boolean; start: string; end: string }>>(() => {
    const result: Record<number, { enabled: boolean; start: string; end: string }> = {};
    for (let day = 0; day < 7; day++) {
      const saved = initialAvailability.find(item => item.weekday === day);
      result[day] = { enabled: !!saved, start: saved?.start_time?.slice(0, 5) || '19:00', end: saved?.end_time?.slice(0, 5) || '21:00' };
    }
    return result;
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [planId, setPlanId] = useState(existingPlanId);
  const [duration, setDuration] = useState(50);
  const activeDays = useMemo(() => Object.values(availability).filter(day => day.enabled).length, [availability]);

  function updateDay(day: number, field: 'enabled' | 'start' | 'end', value: boolean | string) {
    setAvailability(old => ({ ...old, [day]: { ...old[day], [field]: value } }));
  }

  async function saveAndGenerate() {
    setMessage('');
    if (!topics.length) {
      setMessage('Este edital ainda não tem tópicos cadastrados. Volte à análise e confira se as disciplinas foram salvas.');
      return;
    }
    const slots = Object.entries(availability).filter(([, value]) => value.enabled);
    if (!slots.length) {
      setMessage('Selecione pelo menos um dia disponível para estudar.');
      return;
    }
    for (const [day, value] of slots) {
      if (minutes(value.end) <= minutes(value.start)) {
        setMessage('O horário final precisa ser posterior ao horário inicial em todos os dias selecionados.');
        return;
      }
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = examDate ? new Date(examDate + 'T00:00:00') : new Date(today.getTime() + 56 * 86400000);
    if (end <= today) {
      setMessage('A data da prova já passou. Atualize a data do concurso para montar o cronograma.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      setMessage('Sua sessão expirou. Entre novamente.');
      setBusy(false);
      return;
    }

    const availabilityRows = slots.map(([weekday, value]) => ({
      user_id: user.id,
      weekday: Number(weekday),
      start_time: value.start + ':00',
      end_time: value.end + ':00',
    }));
    const { error: clearError } = await supabase.from('study_availability').delete().eq('user_id', user.id);
    if (clearError) {
      setMessage('Não foi possível atualizar sua disponibilidade: ' + clearError.message);
      setBusy(false);
      return;
    }
    const { error: availabilityError } = await supabase.from('study_availability').insert(availabilityRows);
    if (availabilityError) {
      setMessage('Não foi possível salvar seus horários: ' + availabilityError.message);
      setBusy(false);
      return;
    }

    const startDate = dateKey(today);
    const endDate = dateKey(end);
    const { data: plan, error: planError } = await supabase.from('study_plans').insert({
      user_id: user.id,
      exam_id: examId,
      title: 'Cronograma — ' + examTitle,
      starts_on: startDate,
      ends_on: endDate,
      mode: 'hybrid',
      status: 'active',
    }).select('id').single();
    if (planError || !plan) {
      setMessage('Horários salvos, mas não foi possível criar o cronograma: ' + (planError?.message || 'plano não retornado'));
      setBusy(false);
      return;
    }

    const tasks: Array<{ user_id: string; plan_id: string; topic_id: string; title: string; scheduled_for: string; starts_at: string; duration_minutes: number; status: string; notes: string }> = [];
    let topicIndex = 0;
    const orderedSlots = slots.map(([weekday, value]) => ({ weekday: Number(weekday), ...value }));
    for (let day = new Date(today); day <= end && tasks.length < 500; day.setDate(day.getDate() + 1)) {
      const available = orderedSlots.find(slot => slot.weekday === day.getDay());
      if (!available) continue;
      let cursor = minutes(available.start);
      const finish = minutes(available.end);
      while (cursor + duration <= finish && tasks.length < 500) {
        const topic = topics[topicIndex % topics.length];
        const hour = String(Math.floor(cursor / 60)).padStart(2, '0');
        const minute = String(cursor % 60).padStart(2, '0');
        tasks.push({
          user_id: user.id,
          plan_id: plan.id,
          topic_id: topic.id,
          title: topic.title,
          scheduled_for: dateKey(day),
          starts_at: hour + ':' + minute + ':00',
          duration_minutes: duration,
          status: 'pending',
          notes: topic.subjectName,
        });
        topicIndex++;
        cursor += duration + 10;
      }
    }

    if (!tasks.length) {
      await supabase.from('study_plans').delete().eq('id', plan.id);
      setMessage('Não foi possível encontrar horários suficientes para criar sessões. Revise os dias e horários.');
      setBusy(false);
      return;
    }
    const { error: tasksError } = await supabase.from('study_tasks').insert(tasks);
    if (tasksError) {
      await supabase.from('study_plans').delete().eq('id', plan.id);
      setMessage('Não foi possível salvar as sessões: ' + tasksError.message);
      setBusy(false);
      return;
    }
    setPlanId(plan.id);
    setMessage('Cronograma criado! Foram distribuídas ' + tasks.length + ' sessões de estudo.');
    setBusy(false);
  }

  return (
    <main className="wrap">
      <nav className="nav"><Link className="brand" href="/">futurador.</Link><Link href="/painel">Voltar ao painel</Link></nav>
      <section className="panel">
        <h1>Montar seu cronograma</h1>
        <p className="muted">{examTitle}</p>
        <p>Encontramos <strong>{topics.length} tópicos</strong> para distribuir. Informe os dias e horários em que você consegue estudar.</p>
        {examDate ? <p className="muted">Data da prova: {new Date(examDate + 'T00:00:00').toLocaleDateString('pt-BR')}</p> : <p className="muted">Sem data de prova cadastrada: o primeiro cronograma será de 8 semanas.</p>}
        <div className="field">
          <label htmlFor="duration">Duração de cada sessão</label>
          <select id="duration" value={duration} onChange={e => setDuration(Number(e.target.value))}>
            <option value={25}>25 minutos</option><option value={40}>40 minutos</option><option value={50}>50 minutos</option><option value={60}>60 minutos</option><option value={90}>90 minutos</option>
          </select>
        </div>
        <h2>Disponibilidade semanal</h2>
        <p className="muted">Você pode alterar os horários depois. Entre uma sessão e outra, o sistema reserva 10 minutos de intervalo.</p>
        <div className="availability-list">
          {days.map((day, index) => (
            <div className="availability-day" key={day}>
              <label className="day-toggle"><input type="checkbox" checked={availability[index].enabled} onChange={e => updateDay(index, 'enabled', e.target.checked)} /> <strong>{day}</strong></label>
              <div className="time-fields">
                <label>Início<input type="time" value={availability[index].start} disabled={!availability[index].enabled} onChange={e => updateDay(index, 'start', e.target.value)} /></label>
                <label>Fim<input type="time" value={availability[index].end} disabled={!availability[index].enabled} onChange={e => updateDay(index, 'end', e.target.value)} /></label>
              </div>
            </div>
          ))}
        </div>
        <p className="muted">{activeDays} dia(s) selecionado(s).</p>
        {message && <p className={message.startsWith('Cronograma criado') ? 'message' : 'message error'}>{message}</p>}
        {planId ? <p><Link className="btn" href={'/cronograma/' + planId}>Abrir meu cronograma</Link></p> : <button className="btn" type="button" onClick={saveAndGenerate} disabled={busy}>{busy ? 'Montando cronograma...' : 'Salvar horários e gerar cronograma'}</button>}
      </section>
    </main>
  );
}
