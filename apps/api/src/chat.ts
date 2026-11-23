import { createHash } from 'node:crypto';
import { BadGatewayException } from '@nestjs/common';
import type { AppContext, Source } from './types';
import { profileKey } from './providers';

export async function answerQuestion(ctx:AppContext,user:string,team:string,conversationId:string,question:string,key:string,requestId:string){
  const run=(domain:string,operation:string,payload:unknown={})=>ctx.db.command(user,team,domain,operation,payload,requestId);
  const fingerprint=createHash('sha256').update(JSON.stringify([conversationId,question])).digest('hex');
  const reservation=await run('quota','reserve',{conversationId,question,key,fingerprint});
  if(reservation.status==='completed')return run('chat','result',{requestId:reservation.requestId});
  const attempt={requestId:reservation.requestId,token:reservation.token};
  const heartbeat=setInterval(()=>{void run('quota','heartbeat',attempt).catch(()=>{});},30000);heartbeat.unref();
  try{
    const profile=profileKey(ctx.cfg);
    const available=await run('chat','has_sources',{profileKey:profile});
    let sources:Source[]=[];
    if(available.available){
      const [vector]=await ctx.ai.embed([question]);
      sources=(await run('chat','retrieve',{profileKey:profile,vector:JSON.stringify(vector)})).map((s:Source,i:number)=>({...s,label:`S${i+1}`}));
    }
    let answer='I could not find enough authorized sources to answer this question.';
    let citations:string[]=[];
    if(sources.length){
      await run('chat','validate',{sources:sources.map(s=>({chunkId:s.chunkId}))});
      const generated=await ctx.ai.answer(question,sources);
      const labels=new Set(sources.map(s=>s.label));
      if(generated.citations.some(label=>!labels.has(label)))throw new BadGatewayException('Answer source validation failed');
      citations=[...new Set(generated.citations)];
      if(citations.length)answer=generated.answer;
    }
    return await run('chat','complete',{...attempt,kind:citations.length?'grounded':'insufficient_sources',answer,
      sources:sources.map(s=>({chunkId:s.chunkId,isCited:citations.includes(s.label)}))});
  }catch(error){
    const code=(error as any)?.message;
    await run('quota','cancel',{...attempt,blocked:['SOURCE_UNAVAILABLE','FORBIDDEN','NOT_FOUND'].includes(code)}).catch(()=>{});
    throw error;
  }finally{clearInterval(heartbeat);}
}
