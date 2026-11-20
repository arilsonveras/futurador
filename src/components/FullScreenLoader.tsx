'use client';

import { useEffect, useState } from 'react';

type Mode = 'search' | 'analyze' | 'save' | 'plan' | 'generic';

const messages: Record<Mode, string[]> = {
  search: [
    'Consultando páginas de bancas organizadoras e órgãos públicos...',
    'Ampliando a busca para encontrar outras fontes do concurso...',
    'Conferindo nomes, datas e links dos resultados encontrados...',
    'Organizando os resultados para você escolher a fonte correta...',
  ],
  analyze: [
    'Acessando o documento e verificando se é um edital oficial...',
    'Conferindo se há retificações que alteram o edital...',
    'Identificando os cargos e as especialidades disponíveis...',
    'Localizando as disciplinas previstas para o cargo...',
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
  const steps = messages[mode];
  useEffect(() => {
    setStep(0);
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % steps.length);
    }, 2400);
    return () => window.clearInterval(timer);
  }, [mode, steps.length]);

  const currentMessage = message || steps[step];
  return (
    <div className="fullscreen-loader" role="status" aria-live="polite" aria-label={currentMessage}>
      <div className="fullscreen-loader-card">
        <div className="loader-orbit"><span /><span /><span /></div>
        <strong>Futurador</strong>
        <p key={currentMessage} className="loader-message">{currentMessage}</p>
        <small>Estamos trabalhando nisso. Não feche esta página.</small>
      </div>
    </div>
  );
}
