import { ArrowRight, BookOpen, CalendarCheck, Check, ChevronRight, FileText, Flame, GraduationCap, Layers3, Menu, ShieldCheck, Sparkles, Target, Timer, TrendingUp, UploadCloud } from 'lucide-react';

const features = [
  { icon: FileText, title: 'Do edital ao plano', text: 'Envie o edital e transforme disciplinas e tópicos em um plano organizado.' },
  { icon: CalendarCheck, title: 'Rotina que cabe na sua vida', text: 'Defina seus horários. O Futurador distribui as matérias sem sobrecarregar sua semana.' },
  { icon: TrendingUp, title: 'Evolução visível', text: 'Registre sessões, acompanhe metas e saiba exatamente onde concentrar seus esforços.' },
];
const subjects = [{ name: 'Direito Constitucional', pct: 78, color: 'blue' }, { name: 'Língua Portuguesa', pct: 62, color: 'violet' }, { name: 'Raciocínio Lógico', pct: 45, color: 'orange' }];

export default function Home() {
  return <main>
    <header className="nav wrap">
      <a className="brand" href="#inicio"><span className="brand-mark"><Layers3 size={21}/></span><span>futurador<span className="brand-dot">.</span></span></a>
      <nav className="nav-links"><a href="#como-funciona">Como funciona</a><a href="#recursos">Recursos</a><a href="#planos">Planos</a></nav>
      <div className="nav-actions"><a className="login-link" href="/login">Entrar</a><a className="btn btn-dark btn-small" href="/cadastro">Começar grátis <ArrowRight size={15}/></a></div>
      <button className="mobile-menu" aria-label="Abrir menu"><Menu/></button>
    </header>

    <section className="hero wrap" id="inicio">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot"/> PLANEJE MELHOR. CHEGUE MAIS LONGE.</div>
        <h1>Seu próximo passo<br/>começa <em>agora.</em></h1>
        <p className="hero-text">Transforme qualquer edital em um plano de estudos inteligente. Organize sua rotina, acompanhe sua evolução e estude com direção.</p>
        <div className="hero-actions"><a className="btn btn-primary" href="/cadastro">Monte seu plano grátis <ArrowRight size={17}/></a><a className="text-link" href="#como-funciona">Conheça a plataforma <ChevronRight size={16}/></a></div>
        <div className="trust-row"><div className="avatar-stack"><span>A</span><span>M</span><span>J</span><span>+</span></div><div><strong>Seu ritmo, sua estratégia.</strong><small>Planejamento flexível para sua aprovação.</small></div></div>
      </div>
      <div className="hero-visual">
        <div className="visual-glow"/>
        <div className="dash-card">
          <div className="dash-top"><div><span className="muted-label">VISÃO GERAL</span><h3>Seu progresso</h3></div><span className="live-pill"><span/> Esta semana</span></div>
          <div className="progress-main"><div><span className="muted-label">HORAS ESTUDADAS</span><div className="big-number">18<span>h 40min</span></div><small className="positive"><TrendingUp size={13}/> +12% <span>vs. semana passada</span></small></div><div className="donut"><div><strong>76%</strong><small>da meta</small></div></div></div>
          <div className="week-bars"><div className="bar-labels"><span>SEG</span><span>TER</span><span>QUA</span><span>QUI</span><span>SEX</span><span>SÁB</span><span>DOM</span></div><div className="bars">{[48,75,58,92,68,84,28].map((h,i)=><div className="bar-track" key={i}><i style={{height:`${h}%`}} className={i===3?'bar-active':''}/></div>)}</div></div>
          <div className="dash-divider"/><div className="subjects-head"><strong>Desempenho por matéria</strong><span>Ver tudo <ChevronRight size={13}/></span></div>
          <div className="subject-list">{subjects.map(s=><div className="subject" key={s.name}><div className="subject-info"><span>{s.name}</span><b>{s.pct}%</b></div><div className="subject-track"><i className={s.color} style={{width:`${s.pct}%`}}/></div></div>)}</div>
        </div>
        <div className="floating-note"><span className="note-icon"><CalendarCheck size={17}/></span><div><strong>Plano atualizado!</strong><small>Sua semana está organizada.</small></div><Check size={16} className="note-check"/></div>
        <div className="floating-streak"><span><Flame size={16}/></span><div><strong>7 dias</strong><small>de constância</small></div></div>
      </div>
    </section>

    <section className="metrics wrap"><div><strong>100%</strong><span>personalizável</span></div><i/><div><strong>1 lugar</strong><span>para sua preparação</span></div><i/><div><strong>Seu ritmo</strong><span>sem fórmulas prontas</span></div><i/><div><strong>Grátis</strong><span>para começar</span></div></section>

    <section className="how-section" id="como-funciona"><div className="wrap"><div className="section-heading"><span className="eyebrow">SIMPLES DO COMEÇO AO FIM</span><h2>Menos tempo organizando.<br/><em>Mais tempo evoluindo.</em></h2><p>Uma preparação bem planejada começa com clareza. O Futurador ajuda você em cada etapa.</p></div><div className="steps-grid"><article className="step-card"><div className="step-number">01</div><div className="step-icon"><UploadCloud/></div><h3>Adicione seu edital</h3><p>Envie o PDF do concurso. O sistema identifica as disciplinas e os assuntos para você revisar.</p><span className="step-foot">EDITAL ORGANIZADO <Check size={14}/></span></article><article className="step-card featured-step"><div className="step-number">02</div><div className="step-icon"><Sparkles/></div><h3>Monte sua estratégia</h3><p>Informe seus dias e horários disponíveis. Receba uma sugestão de cronograma feita para sua realidade.</p><span className="step-foot">PLANO PERSONALIZADO <Check size={14}/></span></article><article className="step-card"><div className="step-number">03</div><div className="step-icon"><Target/></div><h3>Acompanhe sua evolução</h3><p>Marque tarefas concluídas, registre seu desempenho e ajuste a rota sempre que precisar.</p><span className="step-foot">PROGRESSO CONTÍNUO <Check size={14}/></span></article></div></div></section>

    <section className="features-section wrap" id="recursos"><div className="features-intro"><span className="eyebrow">FEITO PARA SUA JORNADA</span><h2>Um plano inteligente.<br/><em>Uma conquista possível.</em></h2><p>Você não precisa estudar mais horas a qualquer custo. Precisa usar melhor o tempo que tem.</p><a href="/cadastro" className="text-link">Comece sua jornada <ArrowRight size={16}/></a></div><div className="feature-list">{features.map((f,i)=><article className="feature-row" key={f.title}><div className="feature-icon"><f.icon size={21}/></div><div><h3>{f.title}</h3><p>{f.text}</p></div><span>0{i+1}</span></article>)}</div></section>

    <section className="cta-section wrap" id="planos"><div className="cta-inner"><div className="cta-orb orb-one"/><div className="cta-orb orb-two"/><span className="eyebrow">O FUTURO NÃO ESPERA</span><h2>Comece com o que você tem.<br/><em>Construa o que você quer.</em></h2><p>Crie sua conta gratuita e dê o primeiro passo para uma preparação mais organizada.</p><a className="btn btn-light" href="/cadastro">Criar minha conta grátis <ArrowRight size={17}/></a><small>Sem cartão de crédito para começar.</small></div></section>
    <footer className="footer wrap"><a className="brand" href="#inicio"><span className="brand-mark"><Layers3 size={19}/></span><span>futurador<span className="brand-dot">.</span></span></a><span>© 2026 Futurador. Seu futuro, seu planejamento.</span><div><a href="#recursos">Recursos</a><a href="#planos">Planos</a><a href="mailto:contato@futurador.app">Contato</a></div></footer>
  </main>;
}
