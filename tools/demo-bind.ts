/** Run before first real demo login. Reads only a private local subject mapping. */
import { readFileSync } from 'node:fs';
import { createClient as supabase } from '@supabase/supabase-js';
import { z } from 'zod';
import { config, uuid } from '../apps/api/src/config';
import { createClient } from './database/database';
import { demo, localDatabaseUrl } from './database/config';

async function main(){
  const names=['ali','sara','hina','ahmed'] as const;
  const mapping=z.object({ali:uuid,sara:uuid,hina:uuid,ahmed:uuid}).strict().parse(JSON.parse(readFileSync('.tmp/demo-subjects.json','utf8')));
  if(new Set(Object.values(mapping)).size!==4)throw new Error('Four distinct Auth subjects are required');
  const cfg=config();if(!cfg.supabaseUrl||!cfg.storageKey)throw new Error('Configure server Supabase settings locally first');
  const auth=supabase(cfg.supabaseUrl,cfg.storageKey,{auth:{persistSession:false,autoRefreshToken:false}});
  for(const name of names){const {data,error}=await auth.auth.admin.getUserById(mapping[name]);
    if(error||data.user?.id!==mapping[name])throw new Error(`Auth account verification failed for ${name}`);}
  const client=createClient(localDatabaseUrl('MIGRATION_DATABASE_URL','assistant'));await client.connect();
  try{await client.query('BEGIN');await client.query('SET LOCAL ROLE app_owner');
    for(const name of names){
      const result=await client.query("UPDATE app.users SET auth_subject=$1 WHERE id=$2 AND (auth_subject=$1 OR auth_subject::text LIKE 'f0000000-0000-4000-8000-%') RETURNING id",[mapping[name],demo.users[name]]);
      if(result.rowCount!==1)throw new Error(`Existing ${name} binding was preserved; review the private mapping`);
    }
    await client.query('COMMIT');console.log('Verified and bound four TechCo Auth subjects. No passwords or tokens were printed.');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{await client.end();}
}
main().catch(()=>{console.error('Demo binding failed. Check the private mapping, pre-login ordering, Auth accounts and server settings. No accounts were created and no credentials were printed.');process.exitCode=1;});
