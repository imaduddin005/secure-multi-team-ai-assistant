/** Opt-in LIVE check. Creates/deletes only a synthetic canary under a random prefix. */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { config } from '../apps/api/src/config';
import { required } from './database/config';

async function main(){
  const cfg=config();const jwt=required('LIVE_TEST_USER_JWT');
  if(!cfg.supabaseUrl||!cfg.storageKey||!cfg.publishableKey)throw new Error('Missing private storage configuration');
  const server=createClient(cfg.supabaseUrl,cfg.storageKey,{auth:{persistSession:false,autoRefreshToken:false}}).storage.from(cfg.bucket);
  const key=`security-check/${randomUUID()}/canary.txt`;
  const original=Buffer.from('Synthetic storage authorization probe.');
  const encoded=key.split('/').map(encodeURIComponent).join('/');const bucket=encodeURIComponent(cfg.bucket);
  const {error}=await server.upload(key,original,{contentType:'text/plain',upsert:false});if(error)throw new Error('Canary setup failed');
  let checks=0;
  const send=(path:string,token:string|undefined,init:RequestInit={})=>fetch(`${cfg.supabaseUrl}/storage/v1/${path}`,{
    ...init,headers:{apikey:cfg.publishableKey,...(token?{Authorization:`Bearer ${token}`} : {}),...init.headers},signal:AbortSignal.timeout(15000)});
  try{
    for(const token of [undefined,jwt]){
      for(const route of [`object/${bucket}/${encoded}`,`object/authenticated/${bucket}/${encoded}`,`object/public/${bucket}/${encoded}`]){
        const response=await send(route,token);if(response.ok)throw new Error('Direct canary read unexpectedly allowed');await response.body?.cancel();checks++;
      }
      const listing=await send(`object/list/${bucket}`,token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefix:'security-check',limit:100})});
      if(listing.ok&&(await listing.json() as any[]).length)throw new Error('Direct canary listing unexpectedly visible');checks++;
      const write=await send(`object/${bucket}/${encoded}.upload`,token,{method:'POST',headers:{'Content-Type':'text/plain'},body:original});
      if(write.ok)throw new Error('Direct canary upload unexpectedly allowed');await write.body?.cancel();checks++;
      const remove=await send(`object/${bucket}`,token,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[key]})});await remove.body?.cancel();
      const remaining=await server.download(key);if(remaining.error||!remaining.data)throw new Error('Direct canary deletion unexpectedly allowed');checks++;
    }
    console.log(`LIVE Storage: ${checks} canary checks passed for anonymous and ordinary authenticated access. No existing object was modified.`);
  }finally{await server.remove([key,`${key}.upload`]);}
}
main().catch(()=>{console.error('LIVE Storage check failed or is not configured. Review private settings and bucket policies. No tokens or storage responses were logged.');process.exitCode=1;});
