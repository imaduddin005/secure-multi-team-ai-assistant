import { config } from './config';
import { CompatibleAI, SupabaseStorage } from './providers';
import { Processor, startQueueWorker } from './processing';
async function main(){const cfg=config();const processor=new Processor(cfg,new SupabaseStorage(cfg),new CompatibleAI(cfg));
  const close=await startQueueWorker(processor,cfg);
  const timer=setInterval(()=>{void processor.pool.query('SELECT app_private.recover_quota()').catch(()=>{});},30000);
  for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{clearInterval(timer);void close().finally(()=>process.exit());});}
main().catch(()=>{console.error('Worker startup failed; check Redis, database and private service configuration.');process.exitCode=1;});
