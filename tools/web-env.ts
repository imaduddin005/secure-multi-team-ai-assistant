import { existsSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const destination=resolve('apps/web/.env.local');
if(existsSync(destination))console.log('Existing frontend environment preserved.');
else{
  const names=['NEXT_PUBLIC_API_BASE_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'';
  let legacyRole='';try{legacyRole=JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString()).role||'';}catch{}
  if(key.startsWith('sb_secret_')||legacyRole==='service_role')throw new Error('Server credentials must never be copied to public frontend configuration');
  writeFileSync(destination,names.map(name=>`${name}=${JSON.stringify(process.env[name]||'')}`).join('\n')+'\n',{flag:'wx'});
  console.log('Created frontend public configuration only. Private root settings were not copied.');
}
