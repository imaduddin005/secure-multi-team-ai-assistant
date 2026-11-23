import { createApp } from './app';
async function main(){const {app,ctx,close}=await createApp();await app.listen(ctx.cfg.port,'127.0.0.1');
  console.log(`API listening on http://127.0.0.1:${ctx.cfg.port}`);
  for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{void close().finally(()=>process.exit());});}
main().catch(()=>{console.error('API startup failed; check private configuration and database readiness.');process.exitCode=1;});
