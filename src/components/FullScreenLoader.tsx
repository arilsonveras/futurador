'use client';

import { useEffect, useState } from 'react';

type Mode = 'search' | 'analyze' | 'save' | 'plan' | 'generic';

const messages: Record<Mode, string[]> = {
  search: [
    'Consultando páginas de bancas organizadoras e órgãos públicos...',
    'Pesquisando também por nomes completos e abreviações do concurso...',
    'Ampliando a busca para encontrar outras fontes relacionadas...',
    'Conferindo nomes, datas e links dos resultados encontrados...',
    'Organizando todos os resultados para você escolher...',
  ],
  analyze: [
    'Acessando o documento e verificando se é um edital oficial...',
    'Lendo o PDF e separando as páginas mais importantes...',
    'Conferindo se há retificações que alteram o edital...',
    'Identificando os cargos, especialidades e vagas disponíveis...',
    'Localizando as disciplinas previstas para cada cargo...',
    'Separando os tópicos do conteúdo programático...',
    'Conferindo a data da prova e as informações do cronograma...',
    'Organizando os dados para apresentar uma análise confiável...',
  ],
  save: [
    'Salvando os dados do concurso na sua área de estudos...',
    'Organizando os cargos e vinculando as disciplinas...',
    'Registrando os tópicos do edital para o planejamento...',
    'Preparando o próximo passo da configuração do seu plano...',
  ],
  plan: [
    'Analisando sua disponibilidade de horários...',
    'Distribuindo as disciplinas ao longo dos seus dias de estudo...',
    'Organizando os tópicos conforme a prioridade do edital...',
    'Reservando espaço para revisões e simulados...',
    'Montando seu calendário de estudos personalizado...',
  ],
  generic: [
    'Organizando as informações da sua solicitação...',
    'Conferindo os dados para evitar inconsistências...',
    'Preparando a próxima etapa...',
  ],
};

export default function FullScreenLoader({
  message,
  mode = 'generic',
}: {
  message?: string;
  mode?: Mode;
}) {
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(6);
  const steps = messages[mode];

  useEffect(() => {
    setStep(0);
    setProgress(6);
    const messageTimer = window.setInterval(() => {
      setStep((current) => (current + 1) % steps.length);
    }, 2400);
    const progressTimer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 95) return 95;
        const increment = current < 55 ? 1.8 : current < 78 ? 0.8 : 0.25;
        return Math.min(95, current + increment);
      });
    }, 500);
    return () => {
      window.clearInterval(messageTimer);
      window.clearInterval(progressTimer);
    };
  }, [mode, steps.length]);

  const currentMessage = message || steps[step];
  const displayedProgress = Math.round(progress);
  return (
    <div className="fullscreen-loader" role="status" aria-live="polite" aria-label={currentMessage}>
      <div className="fullscreen-loader-card">
        <div className="loader-orbit"><span /><span /><span /></div>
        <strong>Futurador</strong>
        <p key={currentMessage} className="loader-message">{currentMessage}</p>
        <div className="loader-progress-heading">
          <span>Progresso estimado</span>
          <strong>{displayedProgress}%</strong>
        </div>
        <div className="loader-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={displayedProgress}>
          <span style={{ width: displayedProgress + '%' }} />
        </div>
        <small>O percentual é uma estimativa visual. Estamos trabalhando nisso; não feche esta página.</small>
      </div>
    </div>
  );
}
