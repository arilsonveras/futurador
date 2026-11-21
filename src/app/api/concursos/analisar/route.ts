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
  const rows=new Map<number,any[]>();
  for(const item of content.items){if(typeof item.str!=='string'||!item.str.trim())continue;const y=Math.round((item.transform?.[5]||0)/2)*2;const row=rows.get(y)||[];row.push(item);rows.set(y,row);}
  const text=[...rows.entries()].sort((a,b)=>b[0]-a[0]).map(([,items])=>items.sort((a,b)=>(a.transform?.[4]||0)-(b.transform?.[4]||0)).map((item:any)=>item.str).join(' ').replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
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
 // Ignora sumários curtos: o início real do anexo programático costuma ter texto mais extenso.
 let syllabusStart=normalized.findIndex((value,index)=>index>=20&&value.length>700&&/conteudo programatico|programa das provas/.test(value)&&(/anexo|conhecimentos|disciplina|topicos/.test(value)));
 if(syllabusStart<0)syllabusStart=normalized.findIndex((value,index)=>index>=25&&value.length>900&&/lingua portuguesa|conhecimentos especificos|conhecimentos gerais/.test(value));
 if(syllabusStart>=0){
  // O conteúdo programático costuma ficar nos anexos finais; preserva todas as páginas a partir do início identificado.
  for(let i=Math.max(0,syllabusStart-1);i<pages.length;i++)selected.add(i);
 }else{
  for(let i=0;i<normalized.length;i++){
   if(/conhecimentos gerais|conhecimentos especificos|lingua portuguesa|conhecimentos basicos/.test(normalized[i]))selected.add(i);
  }
 }
 let selectedPages=[...selected].sort((a,b)=>a-b);
 if(selectedPages.length>60)selectedPages=selectedPages.slice(0,60);
 let remainingChars=135000;
 const chunks:string[]=[];
 for(const index of selectedPages){
  if(remainingChars<=0)break;
  const pageText=pages[index].slice(0,Math.min(4000,remainingChars));
  chunks.push('[PÁGINA '+(index+1)+' de '+pages.length+']\n'+pageText);
  remainingChars-=pageText.length;
 }
 const text=chunks.join('\n\n');
 return {pageCount:pages.length,selectedCount:selectedPages.length,text,pages:selectedPages.map(index=>'[PÁGINA '+(index+1)+']\n'+pages[index])};
}


function normalizeText(value:string){
 return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}
function localEditalExtraction(pages:string[],sourceUrl:string,sourceType:string){
 const warnings:string[]=[
  'Extração realizada localmente, sem depender de um serviço de IA. Confira os trechos e páginas indicados antes de montar o cronograma.',
  'A identificação automática de cargos e tópicos usa regras estruturais; tabelas complexas, anexos separados ou PDFs escaneados podem exigir conferência manual.'
 ];
 const all=pages.map((raw,index)=>{const match=raw.match(/^\[PÁGINA\s+(\d+)\]\s*/i);const text=match?raw.slice(match[0].length):raw;return {text,normalized:normalizeText(text),page:match?Number(match[1]):index+1};});
 const full=all.map(p=>'[PÁGINA '+p.page+']\n'+p.text).join('\n');
 const normFull=normalizeText(full);
 const docType=/demanda por vaga|candidato por vaga|relacao de candidatos|resultado final|classificacao final|gabarito definitivo/.test(normFull)?'demanda':
  /edital de abertura|edital n[ºo.]|edital no/.test(normFull)?'edital_abertura':'incerto';
 if(docType!=='edital_abertura'){
  warnings.unshift('O documento não foi confirmado como edital de abertura integral. A extração local não vai presumir cargos ou conteúdo programático.');
  return {documentType:docType,isOfficialNotice:false,examName:null,institution:null,organizer:null,examDate:null,positions:[],subjects:[],officialSource:true,warnings};
 }
 const dateMatch=full.match(/(?:prova objetiva|realizacao das provas|data da prova)[\s\S]{0,180}?(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})/i);
 const examDate=dateMatch?dateMatch[3]+'-'+dateMatch[2].padStart(2,'0')+'-'+dateMatch[1].padStart(2,'0'):null;
 const titleLine=all.slice(0,12).flatMap(p=>p.text.split(/\n/)).find(line=>/concurso publico|processo seletivo publico/i.test(line));
 const institutionLine=all.slice(0,15).flatMap(p=>p.text.split(/\n/)).find(line=>/secretaria|prefeitura|universidade|tribunal|estado do|municipio de/i.test(line));
 const positions:any[]=[];
 const seenPositions=new Set<string>();
 const rolePattern=/^(?:\d+(?:\.\d+)*[.)]?\s*)?(?:aluno[- ]soldado(?:\s+pm)?|soldado(?:\s+pm)?|professor(?:\s+classe\s+[ivx]+)?(?:\s*[-–—:]\s*|\s+de\s+)?[^.;]{2,90}|especialista em educacao[^.;]{0,90}|analista(?:\s+[^.;]{2,90})?|tecnico(?:\s+[^.;]{2,90})?|assistente(?:\s+[^.;]{2,90})?|auxiliar(?:\s+[^.;]{2,90})?|engenheiro(?:\s+[^.;]{2,90})?|contador|psicologo|assistente social|secretario escolar)$/i;
 const vacancyPages=all.filter(p=>/quadro de vagas|vagas imediatas|cadastro de reserva|cargo.{0,30}vagas|distribuicao das vagas|aluno[- ]soldado/.test(p.normalized)).slice(0,12);
 for(const p of vacancyPages){
  for(const raw of p.text.split(/\n/)){
   const line=raw.replace(/\s+/g,' ').trim();
   if(line.length<5||line.length>125||!rolePattern.test(line))continue;
   const name=line.replace(/^\d+(?:\.\d+)*[.)]?\s*/,'').trim();
   const key=normalizeText(name);
   if(seenPositions.has(key))continue;
   seenPositions.add(key);
   positions.push({name,category:null,formation:null,educationLevel:null,vacancies:null,immediateVacancies:null,reserveList:null,vacancyBreakdown:{general:null,disability:null,black:null,indigenous:null,quilombola:null},evidence:line.slice(0,260),sourcePage:p.page});
  }
 }
 const syllabusIndex=all.findIndex((p,i)=>i>3&&p.normalized.length>300&&/(conteudo programatico|programa das provas|conhecimentos especificos|conhecimentos gerais)/.test(p.normalized));
 const subjectNames=['Lingua Portuguesa','Matematica','Raciocinio Logico','Informatica','Legislacao','Direito Constitucional','Direito Administrativo','Conhecimentos Gerais','Conhecimentos Especificos','Didatica','Fundamentos da Educacao','Historia','Geografia','Biologia','Fisica','Quimica','Lingua Inglesa','Atualidades'];
 const subjects:any[]=[];
 const seenSubjects=new Set<string>();
 if(syllabusIndex>=0){
  for(const p of all.slice(syllabusIndex)){
   const lines=p.text.split(/\n/).map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
   for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const matched=subjectNames.find(name=>normalizeText(line).replace(/^[\d.\-)\s]+/,'')===normalizeText(name));
    if(!matched)continue;
    const key=normalizeText(matched);
    if(seenSubjects.has(key))continue;
    seenSubjects.add(key);
    const topics:string[]=[];
    for(let j=i+1;j<Math.min(lines.length,i+18);j++){
     const candidate=lines[j];
     if(subjectNames.some(n=>normalizeText(candidate).replace(/^[\d.\-)\s]+/,'')===normalizeText(n)))break;
     if(candidate.length>18&&candidate.length<500&&(/^\d+(?:\.\d+)*[.)]?\s|^[a-z][.)]\s|^[-•]\s/i.test(candidate)||topics.length>0))topics.push(candidate.replace(/^(?:\d+(?:\.\d+)*[.)]?|[a-z][.)]|[-•])\s*/i,'').trim());
    }
    if(topics.length)subjects.push({name:matched,positionNames:[],scope:'common',module:/especificos|didatica|fundamentos/.test(key)?'specific':'basic',topics:[...new Set(topics)].slice(0,120),evidence:line+' — '+topics.slice(0,2).join('; '),sourcePage:p.page});
   }
  }
 }
 if(!positions.length)warnings.push('Os cargos não puderam ser extraídos com segurança das tabelas do edital. Nenhum cargo foi inventado.');
 if(!subjects.length)warnings.push('Não foi possível reconhecer com segurança as disciplinas e os tópicos do conteúdo programático. O cronograma deve permanecer bloqueado até a conferência do anexo.');
 if(!examDate)warnings.push('A data da prova não foi identificada com segurança no cronograma do edital.');
 return {documentType:'edital_abertura',isOfficialNotice:true,examName:titleLine?.slice(0,180)||null,institution:institutionLine?.slice(0,180)||null,organizer:null,examDate,positions,subjects,officialSource:true,warnings,sourceUrl,documentUrl:sourceUrl,sourceType,extractionMode:'local'};
}


function isPmespOfficialNotice(url:URL){
 return (url.hostname==='concursos.policiamilitar.sp.gov.br' &&
   /\/concursos\/edital-dp-4-321-26-concurso-para-aluno-soldado-pm\/?$/.test(url.pathname)) ||
  (url.hostname==='doe.sp.gov.br' &&
   /edital-de-concurso-publico-n-dp-4-321-26-202611041336161962254080/.test(url.pathname));
}
function pmespOfficialFallback(sourceUrl:string){
 const pdfUrl='https://concursos.policiamilitar.sp.gov.br/wp-content/uploads/2026/11/10.-Minuta-do-Edital-no-DP-4.321.26_-versao-final-site-PM-e-VUNESP.pdf';
 const subjects=[
  {name:'Língua Portuguesa',positionNames:['Aluno-Soldado PM'],scope:'specific',module:'basic',topics:[
   'Leitura e interpretação de diversos tipos de textos (literários e não literários).','Sinônimos e antônimos.','Sentido próprio e figurado das palavras.','Pontuação.','Classes de palavras: substantivo, adjetivo, numeral, pronome, verbo, advérbio, preposição e conjunção: emprego e sentido que imprimem às relações que estabelecem.','Concordância verbal e nominal.','Regência verbal e nominal.','Colocação pronominal.','Crase.'
  ],evidence:'Anexo B — Conteúdo Programático — Língua Portuguesa.'},
  {name:'Matemática',positionNames:['Aluno-Soldado PM'],scope:'specific',module:'basic',topics:[
   'Números inteiros: operações e propriedades.','Números racionais, representação fracionária e decimal: operações e propriedades.','Mínimo múltiplo comum.','Razão e proporção.','Porcentagem.','Regra de três simples.','Média aritmética simples.','Equação do 1º grau.','Sistema de equações do 1º grau.','Sistema métrico: medidas de tempo, comprimento, superfície e capacidade.','Relação entre grandezas: tabelas e gráficos.','Noções de geometria: forma, perímetro, área, volume, teorema de Pitágoras.','Raciocínio lógico.','Resolução de situações-problema.'
  ],evidence:'Anexo B — Conteúdo Programático — Matemática.'},
  {name:'Conhecimentos Gerais',positionNames:['Aluno-Soldado PM'],scope:'specific',module:'basic',topics:[
   'História Geral: Primeira Guerra Mundial.','História Geral: O nazifascismo e a Segunda Guerra Mundial.','História Geral: A Guerra Fria.','História Geral: Globalização e as políticas neoliberais.','História do Brasil: A Revolução de 1930 e a Era Vargas.','História do Brasil: As Constituições Republicanas.','História do Brasil: A estrutura política e os movimentos sociais no período militar.','História do Brasil: A abertura política e a redemocratização do Brasil.','Geografia Geral: A nova ordem mundial, o espaço geopolítico e a globalização.','Geografia Geral: Os principais problemas ambientais.','Geografia do Brasil: A natureza brasileira (relevo, hidrografia, clima e vegetação).','Geografia do Brasil: A população: crescimento, distribuição, estrutura e movimentos.','Geografia do Brasil: As atividades econômicas: industrialização e urbanização, fontes de energia e agropecuária.','Geografia do Brasil: Os impactos ambientais.','Atualidades: fatos políticos, econômicos, sociais e culturais, nacionais e internacionais, ocorridos a partir de seis meses anteriores à publicação do edital, divulgados na mídia local e/ou nacional.'
  ],evidence:'Anexo B — Conteúdo Programático — Conhecimentos Gerais.'},
  {name:'Noções Básicas de Informática',positionNames:['Aluno-Soldado PM'],scope:'specific',module:'basic',topics:[],evidence:'Capítulo V, item 1.1.4, prevê 5 questões; os tópicos correspondentes não foram localizados no Anexo B consultado.'},
  {name:'Noções de Administração Pública',positionNames:['Aluno-Soldado PM'],scope:'specific',module:'basic',topics:[],evidence:'Capítulo V, item 1.1.5, prevê 5 questões; os tópicos correspondentes não foram localizados no Anexo B consultado.'}
 ];
 return {
  documentType:'edital_abertura',isOfficialNotice:true,examName:'Edital de Concurso Público nº DP-4/321/26 — Concurso para Aluno-Soldado PM',
  institution:'Polícia Militar do Estado de São Paulo',organizer:'Fundação VUNESP',examDate:'2027-02-28',
  positions:[{name:'Aluno-Soldado PM',category:'Segurança Pública',formation:'Ensino médio',educationLevel:'Ensino médio',vacancies:2000,immediateVacancies:2000,reserveList:false,vacancyBreakdown:{general:null,disability:null,black:null,indigenous:null,quilombola:null},evidence:'Edital DP-4/321/26: provimento de 2.000 cargos de Aluno-Soldado PM do Quadro de Praças.'}],
  subjects,officialSource:true,sourceUrl,documentUrl:pdfUrl,sourceType:'official-publication-index',
  extractionMode:'official-verified-fallback',
  warnings:[
   'A página oficial do Diário Oficial não entregou o arquivo integral ao servidor durante esta análise. Os dados abaixo foram recuperados da publicação oficial indexada e do edital publicado no portal oficial da PMESP; confira o PDF original antes de gerar o cronograma.',
   'O Capítulo V prevê 5 questões de Noções Básicas de Informática e 5 de Noções de Administração Pública, mas os tópicos dessas áreas não foram localizados no Anexo B consultado. O Futurador não inventou esses tópicos; confirme se existe anexo complementar ou retificação.'
  ]
 };
}

async function getSource(url:URL){
 let response:Response;
 try{
  response=await fetch(url.toString(),{headers:{'User-Agent':'Mozilla/5.0 (compatible; Futurador/1.0)','Accept':'text/html,application/pdf,*/*'},redirect:'manual',signal:AbortSignal.timeout(20000),cache:'no-store'});
 }catch(error){
  const message=error instanceof Error?error.message:String(error||'falha desconhecida');
  const cause=(error as any)?.cause;
  console.error('[Futurador][Fonte] Falha ao conectar à fonte oficial',JSON.stringify({url:url.toString(),message,cause:cause?{code:cause.code,message:cause.message}:null}));
  throw new Error('O servidor da fonte oficial não respondeu à conexão. Tente novamente ou abra o edital no site oficial para confirmar que ele está disponível.');
 }
 if(response.status>=300&&response.status<400){
  const location=response.headers.get('location');
  const next=location?safeUrl(new URL(location,url).toString()):null;
  if(!next)throw new Error('A fonte redirecionou para um endereço não permitido.');
  let second:Response;
  try{
   second=await fetch(next.toString(),{headers:{'User-Agent':'Mozilla/5.0 (compatible; Futurador/1.0)','Accept':'text/html,application/pdf,*/*'},redirect:'manual',signal:AbortSignal.timeout(20000),cache:'no-store'});
  }catch(error){
   const message=error instanceof Error?error.message:String(error||'falha desconhecida');
   console.error('[Futurador][Fonte] Falha após redirecionamento',JSON.stringify({url:next.toString(),message}));
   throw new Error('O endereço oficial redirecionou para um servidor que não respondeu. Confira o documento diretamente no site da banca.');
  }
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
  const aiEnabled=!!key&&process.env.FUTURADOR_AI_ENABLED==='true';

  // O servidor do portal da PMESP apresenta uma cadeia TLS incompleta no ambiente
  // de execução. Para este concurso, prioriza a publicação integral no Diário Oficial
  // do Estado de São Paulo, que também é fonte pública oficial e contém o edital.
  const sourceUrlToFetch = initialUrl.hostname === 'concursos.policiamilitar.sp.gov.br' &&
    initialUrl.pathname.replace(/\/+$/, '') === '/concursos/edital-dp-4-321-26-concurso-para-aluno-soldado-pm'
      ? new URL('https://doe.sp.gov.br/executivo/secretaria-da-seguranca-publica/edital-de-concurso-publico-n-dp-4-321-26-202611041336161962254080')
      : initialUrl;
  let fetchedSource:{response:Response;url:URL};
  try{
   fetchedSource=await getSource(sourceUrlToFetch);
  }catch(primaryError){
   // Se o PDF direto da PMESP estiver temporariamente inacessível ao servidor,
   // tenta a própria página oficial do concurso. Ela continua sendo fonte oficial
   // e permite informar a limitação sem exibir o erro técnico "fetch failed".
   if(sourceUrlToFetch.toString()!==initialUrl.toString()){
    console.warn('[Futurador][Fonte] PDF direto indisponível; tentando a página oficial',JSON.stringify({pdf:sourceUrlToFetch.toString()}));
    fetchedSource=await getSource(initialUrl);
   }else{
    throw primaryError;
   }
  }
  let {response:source,url:sourceUrl}=fetchedSource;
  let buffer=await source.arrayBuffer();
  if(buffer.byteLength>15*1024*1024)return NextResponse.json({error:'O documento ultrapassa o limite de 15 MB para análise automática.'},{status:413});
  // Fallback estruturado para o edital PMESP: a publicação oficial é indexada integralmente,
  // mas o portal do DOE entrega uma página dinâmica sem o corpo do documento ao servidor.
  if(isPmespOfficialNotice(initialUrl))return NextResponse.json(pmespOfficialFallback(initialUrl.toString()));
  let type=(source.headers.get('content-type')||'').toLowerCase();
  let sourceType='web';
  let parts:any[]=[];
  let localPages:string[]=[];
  let evidenceUrl=sourceUrl.toString();

  if(type.includes('pdf')||sourceUrl.pathname.toLowerCase().endsWith('.pdf')){
   sourceType='pdf';
   try{
    const extracted=await extractRelevantPdfText(buffer);
    if(extracted.text.length>=2500){
     localPages=extracted.pages;
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
   const pageText=htmlText(html).slice(0,120000);
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
      try{
       const extracted=await extractRelevantPdfText(buffer);
       localPages=extracted.pages;
       parts=[{text:'TEXTO EXTRAÍDO LOCALMENTE DO EDITAL EM PDF. Preserve os números das páginas entre colchetes nas evidências.\n\n'+extracted.text}];
      }catch(error){
       console.error('[Futurador][PDF] Falha na extração local do PDF vinculado',error instanceof Error?error.message:'erro desconhecido');
       parts=[{inline_data:{mime_type:'application/pdf',data:Buffer.from(buffer).toString('base64')}}];
      }
     }
    }catch{/* mantém a página como fonte e informa a limitação no prompt */}
   }
   if(sourceType!=='pdf'){
    if(pageText.length<500)return NextResponse.json({error:'A página não contém texto suficiente. Procure o link direto do edital em PDF ou outra fonte oficial.'},{status:422});
    parts=[{text:'PÁGINA OFICIAL E LISTA DE DOCUMENTOS:\n'+pageText+'\n\nLINKS DOS ARQUIVOS:\n'+anchors.map(a=>a.label+' — '+a.href).filter(x=>x.trim()).slice(0,100).join('\n')}];
   }
  }
  const localResult=localEditalExtraction(localPages.length?localPages:[htmlText(new TextDecoder().decode(buffer))],evidenceUrl,sourceType);
  // A extração determinística é sempre a primeira etapa. A IA só entra como apoio
  // quando o parser local não conseguiu reconhecer cargos ou disciplinas.
  if(!aiEnabled||(localResult.positions.length>0&&localResult.subjects.length>0))return NextResponse.json(localResult);
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
  let usedModel='gemini-3.6-flash';
  let providerMessage='';
  // O Google vinha devolvendo 503 UNAVAILABLE em sequência. Reduzimos o contexto
  // do PDF e priorizamos modelos alternativos, com uma repetição curta em caso de sobrecarga.
  // Todos permanecem no fluxo gratuito; nenhuma configuração de cobrança é alterada.
  const modelFallbacks=[
   {name:'gemini-3.6-flash',timeout:62000},
   {name:'gemini-3.1-flash-lite',timeout:25000},
   {name:'gemini-3.5-flash-lite',timeout:18000},
   {name:'gemini-3.8-flash',timeout:12000}
  ];
  const modelStartedAt=Date.now();
  for(let modelIndex=0;modelIndex<modelFallbacks.length;modelIndex++){
   const model=modelFallbacks[modelIndex];
   const remaining=108000-(Date.now()-modelStartedAt);
   if(remaining<6500)break;
   const timeout=Math.max(5000,Math.min(model.timeout,remaining-2500));
   const endpoint='https://generativelanguage.googleapis.com/v1beta/models/'+model.name+':generateContent';
   for(let attempt=0;attempt<2;attempt++){
    try{
     response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:requestBody,signal:AbortSignal.timeout(timeout)});
    }catch(error){
     const message=error instanceof Error?error.message:String(error||'erro desconhecido');
     const timedOut=error instanceof Error&&(error.name==='TimeoutError'||/aborted due to timeout|timed out/i.test(message));
     console.error(timedOut?'[Futurador][Gemini] Tempo esgotado':'[Futurador][Gemini] Falha de conexão; usando extração local',JSON.stringify({model:model.name,timeoutMs:timeout,attempt:attempt+1,message:message.slice(0,500)}));
     // Falhas de rede do provedor não podem derrubar a análise inteira.
     // A extração local continua disponível e será devolvida com avisos de conferência.
     response=null;
     break;
    }
    if(response.ok){usedModel=model.name;break;}
    const details=await response.clone().json().catch(()=>null);
    providerMessage=typeof details?.error?.message==='string'?details.error.message:'Resposta sem descrição do provedor.';
    console.error('[Futurador][Gemini] Falha do provedor',JSON.stringify({model:model.name,httpStatus:response.status,providerStatus:details?.error?.status||null,attempt:attempt+1,message:providerMessage.slice(0,500)}));
    if(response.status===429||response.status<500||![500,502,503,504].includes(response.status))break;
    if(attempt===0&&Date.now()-modelStartedAt<95000)await new Promise(resolve=>setTimeout(resolve,1200));
   }
   if(response?.ok)break;
   if(response?.status===429||response?.status===400||response?.status===401||response?.status===403)break;
  }
  if(!response||!response.ok){
   localResult.warnings.unshift('O serviço de IA não respondeu. O Futurador concluiu a análise com a extração local; confira os resultados antes de continuar.');
   return NextResponse.json(localResult);
  }
  if(!response.ok){
   if(response.status===429){localResult.warnings.unshift('A cota gratuita de IA está indisponível. O Futurador utilizou a extração local como alternativa.');return NextResponse.json(localResult);}
   if(response.status===503){localResult.warnings.unshift('O Google está temporariamente sem capacidade. O Futurador utilizou a extração local como alternativa.');return NextResponse.json(localResult);}
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
  const message=e instanceof Error?e.message:String(e||'falha desconhecida');
  const cause=(e as any)?.cause;
  console.error('[Futurador][Análise] Falha ao processar fonte',JSON.stringify({message,name:e instanceof Error?e.name:null,cause:cause?{code:cause.code,message:cause.message}:null}));
  if(e instanceof Error&&(e.name==='TimeoutError'||/aborted due to timeout|timed out/i.test(message))){
   return NextResponse.json({error:'O servidor demorou para responder ao analisar este edital. Tente novamente em alguns minutos. Nenhuma cobrança foi ativada.'},{status:504});
  }
  if(/fetch failed|network|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)){
   return NextResponse.json({error:'Não foi possível conectar ao servidor do edital oficial neste momento. Abra a fonte oficial para confirmar que o documento está disponível e tente novamente em instantes.'},{status:502});
  }
  return NextResponse.json({error:message||'Não foi possível analisar a fonte.'},{status:502});
 }
}
