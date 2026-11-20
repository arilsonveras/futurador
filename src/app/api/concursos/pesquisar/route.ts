import { NextResponse } from 'next/server';
export const runtime='nodejs';
export const maxDuration=20;
function decodeHtml(s:string){return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));}
function clean(s:string){return decodeHtml(s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ')).trim();}
function target(raw:string){try{const u=new URL(decodeHtml(raw),'https://duckduckgo.com');const t=u.searchParams.get('uddg');const x=new URL(t?decodeURIComponent(t):u.toString());return ['http:','https:'].includes(x.protocol)&&!x.hostname.endsWith('duckduckgo.com')?x.toString():null;}catch{return null;}}
export async function POST(req:Request){
 try{
  const body=await req.json().catch(()=>null);const q=typeof body?.query==='string'?body.query.trim():'';
  if(q.length<3||q.length>160)return NextResponse.json({error:'Informe o nome do concurso (de 3 a 160 caracteres).'},{status:400});
  const terms=[q+' edital concurso banca organizadora',q+' edital site oficial cronograma conteúdo programático'];const found=new Map<string,{title:string;url:string;snippet:string;source:string}>();
  for(const term of terms){const response=await fetch('https://html.duckduckgo.com/html/?q='+encodeURIComponent(term),{headers:{'User-Agent':'Mozilla/5.0 (compatible; Futurador/1.0)'},signal:AbortSignal.timeout(8500),cache:'no-store'});if(!response.ok)continue;const html=await response.text();const links=[...html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
   for(const match of links){const url=target(match[1]);if(!url||found.has(url))continue;const around=html.slice(Math.max(0,match.index!-1800),Math.min(html.length,match.index!+3500));const sm=around.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);let source='';try{source=new URL(url).hostname.replace(/^www\./,'')}catch{}found.set(url,{title:clean(match[2]).slice(0,220),url,snippet:sm?clean(sm[1]).slice(0,420):'',source});}
  }
  return NextResponse.json({query:q,results:[...found.values()].slice(0,10),searchedAt:new Date().toISOString()});
 }catch{return NextResponse.json({error:'O serviço de pesquisa não respondeu. Tente novamente em instantes.'},{status:502});}
}