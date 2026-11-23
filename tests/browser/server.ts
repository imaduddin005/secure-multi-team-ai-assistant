/** Isolated browser fixture: real NestJS/PostgreSQL; test-only Auth, AI and Storage. */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createApp } from '../../apps/api/src/app';
import { config } from '../../apps/api/src/config';
import { Processor } from '../../apps/api/src/processing';
import type { AIAdapter, Source, StorageAdapter } from '../../apps/api/src/types';
import { asOwner, bootstrapLocal, migrate, seed } from '../../tools/database/database';
import { demo, localDatabaseUrl } from '../../tools/database/config';

class TestOnlyBrowserStorage implements StorageAdapter {
  private files=new Map<string,Uint8Array>();
  async put(key:string,bytes:Uint8Array){this.files.set(key,new Uint8Array(bytes));}
  async get(key:string){const bytes=this.files.get(key);if(!bytes)throw new Error('TEST_ONLY_OBJECT_MISSING');return bytes;}
  async remove(keys:string[]){for(const key of keys)this.files.delete(key);}
}
class TestOnlyBrowserAI implements AIAdapter {
  async embed(texts:string[]){return texts.map(()=>[1,0,0]);}
  async answer(_question:string,sources:Source[]){return {answer:'Synthetic fixture answer: check the supplied policy excerpt.',citations:[sources[0]!.label]};}
}

async function main(){
  if(process.env.NODE_ENV!=='test')throw new Error('BROWSER_FIXTURE_IS_TEST_ONLY');
  await bootstrapLocal(true);
  await asOwner(localDatabaseUrl('TEST_DATABASE_URL','assistant_test'),async client=>{
    const name=(await client.query("SELECT current_setting('cluster_name') AS name")).rows[0].name;
    if(name!=='secure-assistant-test')throw new Error('UNSAFE_BROWSER_FIXTURE_TARGET');
    await client.query('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS app_private CASCADE; DROP SCHEMA IF EXISTS app_meta CASCADE');
    await migrate(client);await seed(client);
  });
  const jose=await import('jose');const pair=await jose.generateKeyPair('RS256',{extractable:true});
  const jwk={...await jose.exportJWK(pair.publicKey),kid:'test-only-browser',alg:'RS256',use:'sig'};
  const issuer='http://127.0.0.1:44000/auth/v1';
  const names=['ali','sara','hina','ahmed'] as const;
  const tokens:Record<string,string>={};
  const users:Record<string,any>={};
  for(const [index,name]of names.entries()){
    const subject=`f0000000-0000-4000-8000-00000000000${index+1}`;
    tokens[name]=await new jose.SignJWT({role:'authenticated',user_metadata:{name}}).setProtectedHeader({alg:'RS256',kid:jwk.kid})
      .setSubject(subject).setIssuer(issuer).setAudience('authenticated').setIssuedAt().setExpirationTime('1h').sign(pair.privateKey);
    users[name]={id:subject,aud:'authenticated',role:'authenticated',email:`${name}@example.test`,
      email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString(),user_metadata:{name},app_metadata:{provider:'email',providers:['email']}};
  }
  const cfg={...config(),apiDatabaseUrl:localDatabaseUrl('TEST_API_DATABASE_URL','assistant_test'),workerDatabaseUrl:localDatabaseUrl('TEST_WORKER_DATABASE_URL','assistant_test'),
    supabaseUrl:'http://127.0.0.1:44000',issuer,publishableKey:'test-only-public',webOrigin:'http://localhost:3002',
    dimensions:3,embeddingModel:'test-only-browser',answerModel:'test-only-browser',aiBaseUrl:'https://test-only.invalid',
    embeddingBaseUrl:'https://test-only.invalid',answerBaseUrl:'https://test-only.invalid'};
  const storage=new TestOnlyBrowserStorage();const ai=new TestOnlyBrowserAI();
  let running=await createApp({cfg,storage,ai});const processor=new Processor(cfg,storage,ai);
  await running.app.listen(44001,'127.0.0.1');
  let draining:Promise<void>|undefined;
  const drain=()=>draining||= (async()=>{try{for(const job of await processor.command('dispatches'))await processor.process(job.id);}finally{draining=undefined;}})();
  const api=async(name:string,path:string,init:RequestInit={})=>{
    const headers=new Headers(init.headers);headers.set('Authorization',`Bearer ${tokens[name]}`);
    const response=await fetch(`http://127.0.0.1:44001${path}`,{...init,headers});
    if(!response.ok)throw new Error('TEST_ONLY_SEED_API_FAILED');return response;
  };
  let fixtureReady=false;
  const auth=createServer(async(req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','http://localhost:3002');
    res.setHeader('Access-Control-Allow-Headers',req.headers['access-control-request-headers']||'Authorization,Content-Type,apikey,x-client-info,x-supabase-api-version');
    res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Content-Type','application/json');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    try{
      if(req.url==='/auth/v1/.well-known/jwks.json'){res.end(JSON.stringify({keys:[jwk]}));return;}
      if(req.url==='/test-only/ready'){res.statusCode=fixtureReady?200:503;res.end(JSON.stringify({status:fixtureReady?'ready':'starting',layer:'real-api-pg-test-only-providers'}));return;}
      if(req.url==='/test-only/drain'&&req.method==='POST'){await drain();res.end('{"ok":true}');return;}
      if(req.url==='/test-only/restart-api'&&req.method==='POST'){
        // Isolate the next UI scenario's in-memory IP budget; preserve all SQL data.
        await running.close();running=await createApp({cfg,storage,ai});await running.app.listen(44001,'127.0.0.1');res.end('{"ok":true}');return;
      }
      if(req.url?.startsWith('/auth/v1/token')&&req.method==='POST'){
        const chunks:Buffer[]=[];let size=0;for await(const data of req){size+=data.length;if(size>4096)throw new Error('LIMIT');chunks.push(data);}
        const body=JSON.parse(Buffer.concat(chunks).toString());
        const name=names.find(n=>(body.email===`${n}@example.test`&&body.password==='test-only-password')||body.refresh_token===`test-only-refresh-${n}`);
        if(!name){res.writeHead(400);res.end('{"error":"invalid_grant","msg":"Test fixture sign-in rejected"}');return;}
        res.end(JSON.stringify({access_token:tokens[name],token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,
          refresh_token:`test-only-refresh-${name}`,user:users[name]}));return;
      }
      if(req.url?.startsWith('/auth/v1/logout')){res.writeHead(204);res.end();return;}
      if(req.url==='/auth/v1/user'){
        const token=req.headers.authorization?.replace(/^Bearer /,'')||'';
        const {payload}=await jose.jwtVerify(token,pair.publicKey,{issuer,audience:'authenticated'});
        const user=Object.values(users).find(u=>u.id===payload.sub);if(!user)throw new Error('UNKNOWN_TEST_USER');res.end(JSON.stringify(user));return;
      }
      res.writeHead(404);res.end('{"message":"Test fixture route unavailable"}');
    }catch{res.writeHead(401);res.end('{"message":"Test fixture request rejected"}');}
  });
  await new Promise<void>(resolve=>auth.listen(44000,'127.0.0.1',resolve));
  for(const [who,team,id,file]of [
    ['hina',demo.hr,demo.documents.leave,'Leave Policy.txt'],['hina',demo.hr,demo.documents.salary,'Salary Plan.txt'],
    ['ahmed',demo.engineering,demo.documents.api,'API Guide.txt']]){
    const body=new FormData();body.set('file',new Blob([new Uint8Array(readFileSync(`demo-files/${file}`))],{type:'text/plain'}),file);
    await api(who!,`/teams/${team}/documents/${id}/versions`,{method:'POST',body});
  }
  await drain();fixtureReady=true;
  console.log('Browser fixture ready: loopback 44000/44001, isolated test PostgreSQL, synthetic Auth/AI/Storage only.');
  const close=async()=>{await draining;await new Promise<void>(resolve=>auth.close(()=>resolve()));await running.close();await processor.close();};
  for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{void close().finally(()=>process.exit());});
}
main().catch(()=>{console.error('Browser fixture startup failed; check isolated test database and fixture configuration.');process.exit(1);});
