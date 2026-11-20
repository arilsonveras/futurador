import { NextResponse } from 'next/server';
export const runtime='nodejs';
export const maxDuration=25;
type Result={title:string;url:string;snippet:string;source:string};
function decodeHtml(s:string){return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));}
function clean(s:string){return decodeHtml(s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ')).trim();}
function target(raw:string){try{const u=new URL(decodeHtml(raw),'https://duckduckgo.com');const t=u.searchParams.get('uddg');const x=new URL(t||u.toString());return ['http:','https:'].includes(x.protocol)&&!x.hostname.endsWith('duckduckgo.com')?x.toString():null;}catch{return null;}}
function rank(url:string,title:string){const x=(url+' '+title).toLowerCase();return (x.includes('conhecimento.fgv.br/concursos')?100:0)+(x.includes('gov.br')||x.includes('.pa.gov.br')?35:0)+(x.includes('edital')?12:0);}
async function search(term:string){const response=await fetch('https://html.duckduckgo.com/html/?q='+encodeURIComponent(term),{headers:{'User-Agent':'Mozilla/5.0 (compatible; Futurador/1.0)','Accept':'text/html'},signal:AbortSignal.timeout(9000),cache:'no-store'});if(!response.ok)return [] as Result[];const html=await response.text();const matches=[...html.matchAll(/<a\b(?=[^>]*\bclass=["'][^"']*result__a)(?=[^>]*\bhref=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/gi)];const out:Result[]=[];for(const m of matches){const href=m[1]||m[0].match(/\bhref=["']([^"']+)["']/i)?.[1];const url=href?target(href):null;if(!url)continue;const around=html.slice(Math.max(0,m.index!-1600),Math.min(html.length,m.index!+3000));const sm=around.match(/class=["']result__snippet["'][^>]*>([\s\S]*?)<\/div>/i);let source='';try{source=new URL(url).hostname.replace(/^www\./,'')}catch{}out.push({title:clean(m[2]).slice(0,220),url,snippet:sm?clean(sm[1]).slice(0,420):'',source});}return out;}
export async function POST(req:Request){
 try{
  const body=await req.json().catch(()=>null);const q=typeof body?.query==='string'?body.query.trim():'';
  if(q.length<3||q.length>160)return NextResponse.json({error:'Informe o nome do concurso (de 3 a 160 caracteres).'},{status:400});
  const normalized=q.replace(/[.,;:_-]+/g,' ').replace(/\s+/g,' ').trim();
  const terms=[normalized+' concurso edital',normalized+' banca organizadora edital oficial',normalized+' conteúdo programático cargos prova'];
  const lower=normalized.toLowerCase();
  if(/seduc/.test(lower)&&/(pa|pará|para)/.test(lower)&&/2026/.test(lower)){
   terms.unshift('site:conhecimento.fgv.br/concursos/seducpa26 SEDUC Pará 2026 FGV edital');
  }
  const batches=await Promise.all(terms.map(t=>search(t).catch(()=>[] as Result[])));
  const found=new Map<string,Result>();
  for(const item of batches.flat()){const prior=found.get(item.url);if(!prior||item.snippet.length>prior.snippet.length)found.set(item.url,item);}
  if(/seduc/.test(lower)&&/(pa|pará|para)/.test(lower)&&/2026/.test(lower)){
   const official='https://conhecimento.fgv.br/concursos/seducpa26';
   found.set(official,{title:'Concurso Público SEDUC-PA 2026 — FGV Conhecimento (página oficial)',url:official,snippet:'Página oficial do concurso da SEPLAD e da Secretaria de Estado de Educação do Pará. Reúne edital, retificações, cronograma e publicações oficiais.',source:'conhecimento.fgv.br'});
  }
  const results=[...found.values()].sort((a,b)=>rank(b.url,b.title)-rank(a.url,a.title)).slice(0,10);
  return NextResponse.json({query:q,results,searchedAt:new Date().toISOString(),searchMode:'expanded'});
 }catch{return NextResponse.json({error:'O serviço de pesquisa não respondeu. Tente novamente em instantes.'},{status:502});}
}