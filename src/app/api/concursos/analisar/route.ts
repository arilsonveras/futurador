import { NextResponse } from 'next/server';
export const runtime='nodejs';
export const maxDuration=300;

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

async function extractRelevantPdfText(buffer:ArrayBuffer){
 // @ts-ignore pdfjs-dist 3.x expõe o build legado sem declaração para este caminho interno.
 const pdfjsModule:any=await import('pdfjs-dist/legacy/build/pdf.js');
 const pdfjs:any=pdfjsModule.default||pdfjsModule;
 const task=pdfjs.getDocument({data:new Uint8Array(buffer),disableFontFace:true,useSystemFonts:true,isEvalSupported:false});
 const document=await task.promise;
 const pages:string[]=[];
 for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
  const page=await document.getPage(pageNumber);
  const content=await page.getTextContent();
  const text=content.items.map((item:any)=>typeof item.str==='string'?item.str:'').filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  pages.push(text);
 }
 const normalized=pages.map(value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());
 const selected=new Set<number>();
 for(let i=0;i<Math.min(12,pages.length);i++)selected.add(i);
 for(let i=0;i<normalized.length;i++){
  if(/quadro.{0,45}vagas|distribuicao.{0,35}vagas|cargos.{0,35}vagas|vagas.{0,35}cargos/.test(normalized[i])){
   for(let j=Math.max(0,i-2);j<=Math.min(pages.length-1,i+2);j++)selected.add(j);
  }
 }
 let syllabusStart=normalized.findIndex((value,index)=>index>=12&&/conteudo programatico|programa das provas/.test(value)&&(/anexo|conhecimentos|disciplina/.test(value)));
 if(syllabusStart<0)syllabusStart=normalized.findIndex((value,index)=>index>=20&&/conteudo programatico|programa das provas/.test(value));
 if(syllabusStart>=0){
  // O conteúdo programático costuma ficar nos anexos finais; preserva todas as páginas a partir do início identificado.
  for(let i=Math.max(0,syllabusStart-1);i<pages.length;i++)selected.add(i);
 }else{
  for(let i=0;i<normalized.length;i++){
   if(/conhecimentos gerais|conhecimentos especificos|lingua portuguesa|conhecimentos basicos/.test(normalized[i]))selected.add(i);
  }
 }
 let selectedPages=[...selected].sort((a,b)=>a-b);
 if(selectedPages.length>70)selectedPages=selectedPages.slice(0,70);
 let remainingChars=220000;
 const chunks:string[]=[];
 for(const index of selectedPages){
  if(remainingChars<=0)break;
  const pageText=pages[index].slice(0,Math.min(6500,remainingChars));
  chunks.push('[PÁGINA '+(index+1)+' de '+pages.length+']\n'+pageText);
  remainingChars-=pageText.length;
 }
 const text=chunks.join('\n\n');
 return {pageCount:pages.length,selectedCount:selectedPages.length,text};
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
   try{
    const extracted=await extractRelevantPdfText(buffer);
    if(extracted.text.length>=2500){
     parts=[{text:'TEXTO EXTRAÍDO DO EDITAL EM PDF. O documento possui '+extracted.pageCount+' páginas; foram selecionadas '+extracted.selectedCount+' páginas iniciais e relevantes para cargos, vagas, cronograma e conteúdo programático. Preserve os números de página entre colchetes nas evidências.\n\n'+extracted.text}];
    }else{
     parts=[{inline_data:{mime_type:'application/pdf',data:Buffer.from(buffer).toString('base64')}}];
    }
   }catch(error){
    console.error('[Futurador][PDF] Falha na extração local; usando PDF original',error instanceof Error?error.message:'erro desconhecido');
    parts=[{inline_data:{mime_type:'application/pdf',data:Buffer.from(buffer).toString('base64')}}];
   }
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
  const requestBody=JSON.stringify({contents:[{role:'user',parts}],generationConfig:{temperature:0.05,maxOutputTokens:16000,responseMimeType:'application/json'}});
  let response:Response|null=null;
  let usedModel='gemini-3.5-flash-lite';
  let providerMessage='';
  // Mantém o modelo gratuito mais econômico como principal. Se o Google devolver 5xx,
  // tenta outros modelos Gemini com faixa gratuita documentada, sem habilitar billing.
  // Não habilita billing nem muda a configuração de cobrança do projeto.
  const modelFallbacks=[
   {name:'gemini-3.5-flash-lite',timeout:48000},
   {name:'gemini-3.8-flash',timeout:10000},
   {name:'gemini-3.6-flash',timeout:10000},
   {name:'gemini-3.1-flash-lite',timeout:10000}
  ];
  const modelStartedAt=Date.now();
  for(let modelIndex=0;modelIndex<modelFallbacks.length;modelIndex++){
   const model=modelFallbacks[modelIndex];
   const remaining=78000-(Date.now()-modelStartedAt);
   if(remaining<7000)break;
   const timeout=Math.max(5000,Math.min(model.timeout,remaining-2500));
   const endpoint='https://generativelanguage.googleapis.com/v1beta/models/'+model.name+':generateContent';
   response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:requestBody,signal:AbortSignal.timeout(timeout)});
   if(response.ok){usedModel=model.name;break;}
   const details=await response.clone().json().catch(()=>null);
   providerMessage=typeof details?.error?.message==='string'?details.error.message:'Resposta sem descrição do provedor.';
   console.error('[Futurador][Gemini] Falha do provedor',JSON.stringify({model:model.name,httpStatus:response.status,providerStatus:details?.error?.status||null,message:providerMessage.slice(0,700)}));
   if(response.status===429||response.status<500||![500,502,503,504].includes(response.status))break;
  }
  if(!response)throw new Error('Não foi possível conectar ao serviço de IA.');
  if(!response.ok){
   if(response.status===429)return NextResponse.json({error:'O limite gratuito de uso da IA foi atingido ou a cota do projeto está indisponível. Confira o painel de uso do Google AI Studio. Nenhuma cobrança será ativada.'},{status:429});
   if(response.status===503)return NextResponse.json({error:'O Google está temporariamente sem capacidade para atender a análise, mesmo após tentar outros modelos disponíveis na faixa gratuita. Aguarde alguns minutos e tente novamente. Nenhuma cobrança foi ativada.'},{status:503});
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
  return NextResponse.json({sourceUrl:initialUrl.toString(),documentUrl:evidenceUrl,sourceType,documentType,isOfficialNotice,aiModel:usedModel,examName:typeof data.examName==='string'?data.examName:null,institution:typeof data.institution==='string'?data.institution:null,organizer:typeof data.organizer==='string'?data.organizer:null,examDate:typeof data.examDate==='string'?data.examDate:null,positions,subjects,officialSource:data.officialSource===true,warnings});
 }catch(e){
  const message=e instanceof Error?e.message:'';
  if(e instanceof Error&&(e.name==='TimeoutError'||/aborted due to timeout|timed out/i.test(message))){
   return NextResponse.json({error:'O Google demorou mais que o limite de espera para analisar este edital. O Futurador já priorizou as páginas relevantes do PDF; tente novamente em alguns minutos. Nenhuma cobrança foi ativada.'},{status:504});
  }
  return NextResponse.json({error:message||'Não foi possível analisar a fonte.'},{status:502});
 }
}
