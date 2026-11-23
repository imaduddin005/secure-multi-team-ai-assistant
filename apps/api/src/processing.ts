import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import type { Config } from './config';
import type { AIAdapter, StorageAdapter } from './types';
import { profileKey } from './providers';

export interface Chunk {ordinal:number;text:string;sha256:string;locationKind:'page'|'lines';pageStart:number|null;pageEnd:number|null;lineStart:number|null;lineEnd:number|null;embedding?:string}
export async function extractChunks(bytes:Uint8Array,mime:string):Promise<Chunk[]> {
  let parts:{page?:number;text:string}[];
  if(mime==='text/plain')parts=[{text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)}];
  else parts=await new Promise((resolve,reject)=>{
    const env:NodeJS.ProcessEnv={};
    for(const key of ['SystemRoot','WINDIR','PATH','Path','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','NODE_ENV'])if(process.env[key])env[key]=process.env[key];
    // Native PDF.js/canvas faults must not terminate the API, BullMQ worker or Jest.
    const worker=spawn(process.execPath,['--max-old-space-size=256',join(__dirname,'extract.worker.js')],{serialization:'advanced',
      stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,env});
    let received=false;
    const timer=setTimeout(()=>{worker.kill();reject(new Error('PDF_TIMEOUT'));},60000);
    worker.once('message',(value:any)=>{
      received=true;clearTimeout(timer);
      Array.isArray(value)&&value.every(part=>part&&typeof part.text==='string')?resolve(value):reject(new Error('UNSUPPORTED_PDF'));
      worker.kill();
    });
    worker.once('exit',()=>{clearTimeout(timer);if(!received)reject(new Error('UNSUPPORTED_PDF'));});
    worker.once('error',()=>{clearTimeout(timer);reject(new Error('UNSUPPORTED_PDF'));});
    worker.send(bytes,error=>{if(error){clearTimeout(timer);worker.kill();reject(new Error('UNSUPPORTED_PDF'));}});
  });
  if(parts.reduce((n,p)=>n+p.text.length,0)>500000)throw new Error('TEXT_TOO_LARGE');
  const chunks:Chunk[]=[];
  for(const part of parts){
    const lines=part.text.split(/\r?\n/);let text='';let start=1;
    const push=(end:number)=>{if(text.trim())chunks.push({ordinal:chunks.length,text:text.trim(),sha256:createHash('sha256').update(text.trim()).digest('hex'),
      locationKind:part.page?'page':'lines',pageStart:part.page||null,pageEnd:part.page||null,lineStart:part.page?null:start,lineEnd:part.page?null:Math.max(start,end)});text='';};
    for(let i=0;i<lines.length;i++){
      // Split oversized lines too; every chunk stays within the DB/provider bound.
      const pieces=(lines[i]||'').match(/.{1,2000}/gu)||[''];
      for(const piece of pieces){if(text.length+piece.length>2400){push(i+1);start=i+1;}text+=piece+'\n';}
    }
    push(lines.length);
  }
  if(!chunks.length||chunks.length>500)throw new Error('UNSUPPORTED_DOCUMENT_SIZE');
  return chunks;
}

export class Processor {
  readonly pool:Pool;
  constructor(private readonly cfg:Config,private readonly storage:StorageAdapter,private readonly ai:AIAdapter){
    this.pool=new Pool({connectionString:cfg.workerDatabaseUrl,max:4,connectionTimeoutMillis:8000});
    this.pool.on('error',()=>{});
  }
  async command(operation:string,payload:unknown={}):Promise<any>{
    const client=await this.pool.connect();
    try {await client.query('BEGIN');const row=await client.query('SELECT app_private.worker_command($1,$2::jsonb) AS result',[operation,JSON.stringify(payload)]);
      await client.query('COMMIT');return row.rows[0].result;
    } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async process(jobId:string):Promise<void>{
    const job=await this.command('claim',{jobId});if(!job)return;
    const token=job.token;
    const heartbeat=setInterval(()=>{void this.command('heartbeat',{jobId,token}).catch(()=>{});},30000);heartbeat.unref();
    try{
      if(job.kind==='process_version'){
        await this.command('profile',{key:profileKey(this.cfg),model:this.cfg.embeddingModel,dimensions:this.cfg.dimensions,chunker:this.cfg.chunkerVersion});
        const bytes=await this.storage.get(job.objectKey);
        if(bytes.length!==job.byteSize||createHash('sha256').update(bytes).digest('hex')!==job.sha256)throw new Error('ORIGINAL_INTEGRITY_FAILURE');
        const chunks=await extractChunks(bytes,job.mimeType);
        for(let i=0;i<chunks.length;i+=32){const batch=chunks.slice(i,i+32);const vectors=await this.ai.embed(batch.map(c=>c.text));
          batch.forEach((chunk,j)=>{const vector=vectors[j];if(!vector||vector.length!==this.cfg.dimensions||vector.some(x=>!Number.isFinite(x))||!vector.some(x=>x!==0))throw new Error('INVALID_EMBEDDING');chunk.embedding=JSON.stringify(vector);});}
        await this.command('complete',{jobId,token,profileKey:profileKey(this.cfg),chunks});
      }else{
        await this.storage.remove(job.kind==='purge_document'?job.objectKeys:[job.objectKey]);
        await this.command('complete',{jobId,token});
      }
    }catch{await this.command('fail',{jobId,token}).catch(()=>{});}finally{clearInterval(heartbeat);}
  }
  async close(){await this.pool.end();}
}
export function redisConnection(url:string){const parsed=new URL(url);const db=Number(decodeURIComponent(parsed.pathname.slice(1))||0);
  if(!['redis:','rediss:'].includes(parsed.protocol)||!Number.isInteger(db)||db<0)throw new Error('Invalid Redis connection URL');
  return {host:parsed.hostname.replace(/^\[|\]$/g,''),port:Number(parsed.port||6379),
  username:decodeURIComponent(parsed.username)||undefined,password:decodeURIComponent(parsed.password)||undefined,db,
  ...(parsed.protocol==='rediss:'?{tls:{}}:{}),maxRetriesPerRequest:null};}
export async function startQueueWorker(processor:Processor,cfg:Config){
  const connection=redisConnection(cfg.redisUrl);
  const queue=new Queue('documents',{connection});
  const worker=new Worker('documents',async job=>processor.process(job.data.jobId),{connection,concurrency:1});
  worker.on('error',()=>console.error('Queue worker unavailable; durable jobs remain in PostgreSQL.'));
  queue.on('error',()=>{});
  let busy=false;
  const reconcile=async()=>{if(busy)return;busy=true;try{
    await processor.command('recover_intents');
    for(const job of await processor.command('dispatches')){
      try{await queue.add('document',{jobId:job.id},{jobId:job.id,attempts:1,removeOnComplete:true,removeOnFail:true});await processor.command('published',{jobId:job.id});}
      catch{await processor.command('publish_failed',{jobId:job.id}).catch(()=>{});}
    }
  }catch{console.error('Reconciliation unavailable; retrying.');}finally{busy=false;}};
  const timer=setInterval(()=>{void reconcile();},5000);void reconcile();
  return async()=>{clearInterval(timer);await worker.close();await queue.close();await processor.close();};
}
