import { NextResponse } from 'next/server';
export const runtime='nodejs';
export const maxDuration=60;

function jsonFrom(value:string){
 const clean=value.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 const start=clean.indexOf('{'),end=clean.lastIndexOf('}');
 if(start<0||end<=start)throw new Error('A IA não retornou dados estruturados.');
 return JSON.parse(clean.slice(start,end+1));
}
function htmlText(html:string){
 return html.replace(/<(script|style|noscript|svg|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi,' ')
  .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi,'\n')
  .replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<')
  .replace(/&gt;/g,'>').replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n').trim();
}
function safeUrl(value:string){
 try{
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password)return null;
  const h=u.hostname.toLowerCase();
  if(h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||/^\d{1,3}(\.\d{1,3}){3}$/.test(h)||h.includes(':'))return null;
  return u;
 }catch{return null;}
}
async function getSource(url:URL){
 const response=await fetch(url.toString(),{headers:{'User-Agent':'Mozilla/5.0 (compatible; Futurador/1.0)','Accept':'text/html,application/pdf,*/*'},redirect:'manual',signal:AbortSignal.timeout(15000),cache:'no-store'});
 if(response.status>=300&&response.status<400){
  const location=response.headers.get('location');
  const next=location?safeUrl(new URL(location,url).toString()):null;
  if(!next)throw new Error('A fonte redirecionou para um endereço não permitido.');
  const second=await fetch(next.toString(),{headers:{'User-Agent':'Mozilla/5.0 (compatible; Futurador/1.0)','Accept':'text/html,application/pdf,*/*'},redirect:'manual',signal:AbortSignal.timeout(15000),cache:'no-store'});
  if(second.status>=300&&second.status<400)throw new Error('A fonte possui redirecionamentos adicionais que não podem ser validados.');
  if(!second.ok)throw new Error('Não foi possível acessar o documento selecionado (HTTP '+second.status+').');
  return {response:second,url:next};
 }
 if(!response.ok)throw new Error('Não foi possível acessar o documento selecionado (HTTP '+response.status+').');
 return {response,url};
}
export async function POST(req:Request){
 try{
  const body=await req.json().catch(()=>null);
  const raw=typeof body?.url==='string'?body.url:'';
  const initialUrl=safeUrl(raw);
  if(!initialUrl)return NextResponse.json({error:'Endereço de fonte inválido. Use um link HTTPS público.'},{status:400});
  const key=process.env.GEMINI_API_KEY;
  if(!key||process.env.FUTURADOR_AI_ENABLED!=='true')return NextResponse.json({error:'A análise automática por IA ainda não está disponível. Nenhuma cobrança foi feita.'},{status:503});

  let {response:source,url:sourceUrl}=await getSource(initialUrl);
  let buffer=await source.arrayBuffer();
  if(buffer.byteLength>15*1024*1024)return NextResponse.json({error:'O documento ultrapassa o limite de 15 MB para análise automática.'},{status:413});
  let type=(source.headers.get('content-type')||'').toLowerCase();
  let sourceType='web';
  let parts:any[]=[];
  let evidenceUrl=sourceUrl.toString();

  if(type.includes('pdf')||sourceUrl.pathname.toLowerCase().endsWith('.pdf')){
   sourceType='pdf';
   parts=[{inline_data:{mime_type:'application/pdf',data:Buffer.from(buffer).toString('base64')}}];
  }else{
   const html=new TextDecoder().decode(buffer);
   const pageText=htmlText(html).slice(0,35000);
   // Muitas páginas de banca apenas listam os arquivos do concurso. Buscar o link do edital retificado evita analisar somente a página-resumo.
   const anchors=[...html.matchAll(/<a\b([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)].map(m=>({
    href:m[2],label:htmlText(m[4]),attrs:(m[1]+' '+m[3]).toLowerCase()
   }));
   const editalLink=anchors.map(a=>({...a,url:safeUrl(new URL(a.href,sourceUrl).toString()),descriptor:(a.label+' '+a.attrs+' '+a.href).toLowerCase(),labelNorm:a.label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()}))
    // Nunca selecionar demanda, concorrência, listas, resultados ou retificações isoladas quando a página oferece o edital consolidado.
    .filter(a=>a.url&&!/demanda|candidat[oa]s?\s*(por|\/|-)\s*vaga|concorr[eê]ncia|inscri[cç][oõ]es|resultado|classifica[cç][aã]o|gabarito|convoca[cç][aã]o/.test(a.descriptor))
    .filter(a=>/edital|retifica|vers[aã]o acess[ií]vel/.test(a.descriptor))
    // "Edital (retificado em...)" é o edital completo consolidado; "1ª/2ª Retificação" é apenas um aditivo.
    .sort((a,b)=>{
      const score=(x:any)=>/^edital\b/.test(x.labelNorm)&&! /^\d/.test(x.labelNorm)?100:
        /edital.*(retificado|consolidado)|versao acessivel/.test(x.labelNorm)?90:
        /retificacao/.test(x.labelNorm)?10:0;
      return score(b)-score(a);
    })[0];
   if(editalLink?.url){
    try{
     const fetched=await getSource(editalLink.url);
     const candidate=await fetched.response.arrayBuffer();
     const candidateType=(fetched.response.headers.get('content-type')||'').toLowerCase();
     if(candidate.byteLength<=15*1024*1024&&(candidateType.includes('pdf')||fetched.url.pathname.toLowerCase().endsWith('.pdf'))){
      buffer=candidate;sourceUrl=fetched.url;sourceType='pdf';evidenceUrl=sourceUrl.toString();
      parts=[{inline_data:{mime_type:'application/pdf',data:Buffer.from(buffer).toString('base64')}}];
     }
    }catch{/* mantém a página como fonte e informa a limitação no prompt */}
   }
   if(sourceType!=='pdf'){
    if(pageText.length<500)return NextResponse.json({error:'A página não contém texto suficiente. Procure o link direto do edital em PDF ou outra fonte oficial.'},{status:422});
    parts=[{text:'PÁGINA OFICIAL E LISTA DE DOCUMENTOS:\n'+pageText+'\n\nLINKS DOS ARQUIVOS:\n'+anchors.map(a=>a.label+' — '+a.href).filter(x=>x.trim()).slice(0,100).join('\n')}];
   }
  }
  parts.push({text:`Você é especialista em leitura de editais de concursos públicos brasileiros. Faça uma extração minuciosa, priorizando o edital mais recente e suas retificações. Não use conhecimento externo nem invente dados.
Responda exclusivamente JSON válido neste formato:
{"documentType":"edital_abertura"|"retificacao"|"demanda"|"resultado"|"outro"|"incerto","isOfficialNotice":boolean,"examName":string|null,"institution":string|null,"organizer":string|null,"examDate":"YYYY-MM-DD"|null,"positions":[{"name":string,"category":string|null,"formation":string|null,"educationLevel":string|null,"vacancies":number|null,"immediateVacancies":number|null,"reserveList":boolean|null,"vacancyBreakdown":{"general":number|null,"disability":number|null,"black":number|null,"indigenous":number|null,"quilombola":number|null},"evidence":string}],"subjects":[{"name":string,"positionNames":string[],"scope":"common"|"specific","module":"basic"|"specific","topics":[string],"evidence":string}],"officialSource":boolean,"warnings":string[]}.
REGRAS OBRIGATÓRIAS:
0) IDENTIFICAÇÃO DO DOCUMENTO (ANTES DE EXTRAIR QUALQUER DADO): um PDF intitulado "Edital (retificado em...)" ou "edital consolidado" que contém o texto integral, capítulos, anexos e quadro de cargos é o EDITAL DE ABERTURA CONSOLIDADO (documentType="edital_abertura"), não uma retificação isolada. Só classifique como "retificacao" o documento curto que altera itens/prazos e não reproduz o edital integral. classifique o documento efetivamente recebido. "demanda" inclui relação de candidatos por vaga, demanda por vaga, concorrência e estatísticas de inscritos; "resultado" inclui classificação, gabarito, convocação e resultados. Se for demanda, resultado, outro documento ou incerto, defina isOfficialNotice=false, documentType correspondente, positions=[], subjects=[], examDate=null e explique em warnings que esse arquivo não é o edital de abertura e não contém base segura para o cronograma. NÃO extraia cargos ou vagas de tabelas de demanda. Só use isOfficialNotice=true quando o documento for claramente edital de abertura ou retificação oficial do edital. Uma retificação isolada não autoriza inventar o conteúdo programático ausente: informe se o edital de abertura/anexo de conteúdo não foi localizado. Quando o documento consolidado integral estiver disponível, extraia cargos, vagas e conteúdo dele e aplique as retificações apenas aos itens que elas efetivamente alterarem.
1) CARGOS: não pare em categorias genéricas como "Professor" ou "Especialista em Educação". Extraia cada opção específica de inscrição/formação exatamente como aparece no quadro de vagas: por exemplo "Professor Classe I - Matemática", "Professor Classe I - Língua Portuguesa", etc. Cada especialidade/formação deve ser uma opção separada em positions. Inclua também os cargos administrativos específicos.
2) VAGAS: para cada opção específica, extraia o total de vagas do quadro de vagas e, se possível, vagas imediatas, cadastro de reserva e distribuição por cotas. Não confunda quantidade de inscritos/demanda com número de vagas. Se o documento não informar, use null.
3) CONTEÚDO PROGRAMÁTICO: percorra o edital até os anexos de conteúdo programático. Extraia TODAS as disciplinas e TODOS os tópicos/subtópicos para o cargo/especialidade correspondente. Não retorne apenas títulos de disciplinas. Não misture conteúdo de especialidades diferentes. Disciplinas comuns devem ser associadas a todos os cargos a que o edital as atribui. Preserve hierarquia e texto dos tópicos. Se o conteúdo estiver em anexo separado, identifique isso em warnings em vez de inventar.
4) Evidência: cada cargo e disciplina deve conter trecho literal curto que comprove a extração. Não use evidência genérica.
5) Data da prova somente se expressa claramente no cronograma vigente.
6) Se estiver lendo apenas a página-resumo e não o PDF integral, não simule uma análise completa: retorne warnings informando que o edital integral não foi acessado.
7) Não confunda "Professor" (grupo) com cada formação específica.
URL inicial: ${initialUrl.toString()}
Documento efetivamente analisado: ${evidenceUrl}`});
  const endpoint='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
  const requestBody=JSON.stringify({contents:[{role:'user',parts}],generationConfig:{temperature:0.05,maxOutputTokens:16000,responseMimeType:'application/json'}});
  let response:Response|null=null;
  // Erros 5xx do provedor podem ser transitórios. Faz apenas uma nova tentativa, sem ativar cobrança ou trocar de modelo.
  for(let attempt=0;attempt<2;attempt++){
   response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:requestBody,signal:AbortSignal.timeout(25000)});
   if(response.ok||![500,502,503,504].includes(response.status)||attempt===1)break;
   await new Promise(resolve=>setTimeout(resolve,1800));
  }
  if(!response)throw new Error('Não foi possível conectar ao serviço de IA.');
  if(!response.ok){
   if(response.status===429)return NextResponse.json({error:'O limite gratuito de uso da IA foi atingido. Aguarde a renovação da cota e tente novamente. Nenhuma cobrança será ativada.'},{status:429});
   if(response.status===503)return NextResponse.json({error:'O serviço Gemini está temporariamente indisponível ou sobrecarregado. O Futurador tentou novamente automaticamente, mas o provedor não respondeu. Aguarde alguns minutos e tente outra vez; nenhuma cobrança foi ativada.'},{status:503});
   if(response.status>=500)return NextResponse.json({error:'O serviço de IA apresentou uma falha temporária (HTTP '+response.status+'). Tente novamente em alguns minutos.'},{status:503});
   return NextResponse.json({error:'O serviço de IA recusou a solicitação (HTTP '+response.status+'). Verifique a configuração da chave no painel do projeto.'},{status:502});
  }
  const payload=await response.json();
  const output=payload?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').join('')||'';
  const data=jsonFrom(output);
  if(!Array.isArray(data.positions)||!Array.isArray(data.subjects))throw new Error('A análise retornou uma estrutura incompleta.');
  const documentType=['edital_abertura','retificacao','demanda','resultado','outro','incerto'].includes(data.documentType)?data.documentType:'incerto';
  const isOfficialNotice=data.isOfficialNotice===true&&(documentType==='edital_abertura'||documentType==='retificacao');
  const rejectedDocument=!isOfficialNotice||documentType==='demanda'||documentType==='resultado'||documentType==='outro'||documentType==='incerto';
  const positions=(rejectedDocument?[]:data.positions).filter((x:any)=>x&&typeof x.name==='string').slice(0,150).map((x:any)=>({
   name:x.name,category:typeof x.category==='string'?x.category:null,formation:typeof x.formation==='string'?x.formation:null,
   educationLevel:typeof x.educationLevel==='string'?x.educationLevel:null,
   vacancies:Number.isFinite(x.vacancies)?x.vacancies:null,immediateVacancies:Number.isFinite(x.immediateVacancies)?x.immediateVacancies:null,
   reserveList:typeof x.reserveList==='boolean'?x.reserveList:null,
   vacancyBreakdown:x.vacancyBreakdown&&typeof x.vacancyBreakdown==='object'?x.vacancyBreakdown:null,
   evidence:typeof x.evidence==='string'?x.evidence:''
  }));
  const subjects=(rejectedDocument?[]:data.subjects).filter((x:any)=>x&&typeof x.name==='string'&&Array.isArray(x.topics)).slice(0,200).map((x:any)=>({
   name:x.name,positionNames:Array.isArray(x.positionNames)?x.positionNames.filter((n:any)=>typeof n==='string'):[],
   scope:x.scope==='specific'?'specific':'common',module:x.module==='specific'?'specific':'basic',topics:x.topics.filter((t:any)=>typeof t==='string').slice(0,300),
   evidence:typeof x.evidence==='string'?x.evidence:''
  }));
  const warnings=Array.isArray(data.warnings)?data.warnings.filter((x:any)=>typeof x==='string').slice(0,20):[];
  if(rejectedDocument)warnings.unshift(documentType==='demanda'?'O arquivo selecionado é uma relação de candidatos por vaga/demanda, não o edital de abertura. O Futurador descartou os cargos e números desse documento. Volte à pesquisa e selecione o edital oficial de abertura ou a página oficial da banca.':'O arquivo selecionado não foi identificado com segurança como edital de abertura ou retificação oficial. Nenhum cargo, disciplina ou data foi aproveitado.');
  if(sourceType!=='pdf')warnings.unshift('A fonte analisada foi uma página HTML; o edital em PDF não foi localizado automaticamente. Confira o conteúdo antes de gerar o cronograma.');
  if(!subjects.length||subjects.every((s:any)=>!s.topics.length))warnings.push('Nenhum tópico programático foi extraído. O Futurador deve impedir a geração de um cronograma baseado em conteúdo vazio.');
  return NextResponse.json({sourceUrl:initialUrl.toString(),documentUrl:evidenceUrl,sourceType,documentType,isOfficialNotice,examName:typeof data.examName==='string'?data.examName:null,institution:typeof data.institution==='string'?data.institution:null,organizer:typeof data.organizer==='string'?data.organizer:null,examDate:typeof data.examDate==='string'?data.examDate:null,positions,subjects,officialSource:data.officialSource===true,warnings});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Não foi possível analisar a fonte.'},{status:502});}
}
