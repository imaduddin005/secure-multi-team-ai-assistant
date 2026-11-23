'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';

const base=process.env.NEXT_PUBLIC_API_BASE_URL||'http://localhost:3001';
type Team={id:string;name:string;membershipId:string;role:string};
type Doc={id:string;title:string;visibility:string;status:string};
type Conversation={id:string;title:string};
type Message={id:string;role:string;text?:string;answer?:string;available?:boolean;citations?:any[]};
const authUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||'';
const authKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'';
// One client per runtime; Strict Mode may execute component initializers twice.
const authClient=authUrl&&authKey&&!/YOUR_|REPLACE_ME/.test(`${authUrl}${authKey}`)?createClient(authUrl,authKey,{
  auth:{persistSession:typeof window!=='undefined',autoRefreshToken:typeof window!=='undefined',detectSessionInUrl:typeof window!=='undefined'},
}):null;
export default function Workspace(){
  const auth=authClient;
  const [session,setSession]=useState<Session|null>(null);
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  const [teams,setTeams]=useState<Team[]>([]);const [teamId,setTeamId]=useState('');
  const [profile,setProfile]=useState<{id:string;displayName:string}|null>(null);
  const [tab,setTab]=useState('Chat');const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);const [sending,setSending]=useState(false);
  const [docs,setDocs]=useState<Doc[]>([]);const [search,setSearch]=useState('');
  const [documentQuery,setDocumentQuery]=useState('');const [documentOffset,setDocumentOffset]=useState(0);
  const [conversations,setConversations]=useState<Conversation[]>([]);const [conversation,setConversation]=useState('');
  const [messages,setMessages]=useState<Message[]>([]);const [question,setQuestion]=useState('');
  const [members,setMembers]=useState<any[]>([]);const [usage,setUsage]=useState<any>(null);const [audit,setAudit]=useState<any[]>([]);
  const [versions,setVersions]=useState<any[]>([]);const [versionDoc,setVersionDoc]=useState<Doc|null>(null);
  const [citation,setCitation]=useState<any>(null);const [file,setFile]=useState<File|null>(null);const [title,setTitle]=useState('');
  const [targetUser,setTargetUser]=useState('');const [newRole,setNewRole]=useState('viewer');
  const [grantDoc,setGrantDoc]=useState('');const [grantMember,setGrantMember]=useState('');const [budget,setBudget]=useState(1000);
  const [feedbackComments,setFeedbackComments]=useState<Record<string,string>>({});
  const scope=useRef('');const pending=useRef<{question:string;key:string;conversation:string}|null>(null);
  const token=session?.access_token||'';const team=teams.find(t=>t.id===teamId);
  scope.current=`${token}:${teamId}`;
  const clear=()=>{scope.current=`cleared:${crypto.randomUUID()}`;setDocs([]);setMessages([]);setMembers([]);setAudit([]);setUsage(null);setConversations([]);setConversation('');setVersions([]);setVersionDoc(null);setCitation(null);setFeedbackComments({});setSearch('');setDocumentQuery('');setDocumentOffset(0);setFile(null);setTitle('');setQuestion('');setGrantDoc('');setGrantMember('');pending.current=null;};
  const api=useCallback(async(path:string,options:RequestInit={})=>{
    const current=scope.current;
    const headers=new Headers(options.headers);headers.set('Authorization',`Bearer ${token}`);
    if(options.body && !(options.body instanceof FormData))headers.set('Content-Type','application/json');
    const response=await fetch(`${base}${path}`,{...options,headers,cache:'no-store'});
    if(scope.current!==current)throw new Error('Workspace changed');
    if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||'Request unavailable');}
    if(response.headers.get('content-disposition'))return response;
    const value=await response.json();if(scope.current!==current)throw new Error('Workspace changed');return value;
  },[token]);
  const load=useCallback(async()=>{
    if(!token||!teamId)return;const current=scope.current;
    try{
      const ownTeams:Team[]=await api('/teams');if(scope.current!==current)return;setTeams(ownTeams);
      const currentTeam=ownTeams.find(t=>t.id===teamId);
      if(!currentTeam){clear();setTeamId(ownTeams[0]?.id||'');setError('Your team access changed.');return;}
      const [documents,chats]=await Promise.all([api(`/teams/${teamId}/documents?q=${encodeURIComponent(documentQuery)}&offset=${documentOffset}`),api(`/teams/${teamId}/conversations`)]);
      if(scope.current!==current)return;setDocs(documents);setConversations(chats);
      if(versionDoc){try{const rows=await api(`/teams/${teamId}/documents/${versionDoc.id}/versions`);if(scope.current===current)setVersions(rows);}
        catch{if(scope.current===current){setVersions([]);setVersionDoc(null);}}}
      if(conversation){const history=await api(`/teams/${teamId}/conversations/${conversation}/messages`);if(scope.current===current)setMessages(history);}
      if(currentTeam.role==='admin'){
        const [roster,counts,events]=await Promise.all([api(`/teams/${teamId}/members`),api(`/teams/${teamId}/admin/usage`),api(`/teams/${teamId}/admin/audit`)]);
        if(scope.current!==current)return;setMembers(roster);setUsage(counts);setAudit(events);
      }else{setMembers([]);setUsage(null);setAudit([]);if(tab==='Admin')setTab('Chat');}
    }catch(e){if(scope.current===current){setMessages([]);setCitation(null);setDocs([]);setMembers([]);setAudit([]);setUsage(null);setConversations([]);setVersions([]);setVersionDoc(null);setError((e as Error).message);}}
  },[token,teamId,conversation,api,tab,versionDoc,documentQuery,documentOffset]);
  useEffect(()=>{if(!auth)return;auth.auth.getSession().then(({data})=>setSession(data.session));
    const {data}=auth.auth.onAuthStateChange((_event,value)=>{setSession(value);if(!value){clear();setProfile(null);setTeams([]);setTeamId('');}});
    return()=>data.subscription.unsubscribe();},[auth]);
  useEffect(()=>{let active=true;if(token)Promise.all([api('/teams'),api('/me')]).then(([value,me])=>{if(active){setProfile(me);setTeams(value);setTeamId(old=>value.some((t:Team)=>t.id===old)?old:value[0]?.id||'');}}).catch(e=>active&&setError(e.message));return()=>{active=false;};},[token,api]);
  useEffect(()=>{const timer=setTimeout(()=>{setDocumentQuery(search);setDocumentOffset(0);},300);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{void load();const timer=setInterval(()=>{setCitation(null);void load();},15000);const focus=()=>{setCitation(null);void load();};window.addEventListener('focus',focus);
    return()=>{clearInterval(timer);window.removeEventListener('focus',focus);};},[load]);
  async function action(work:()=>Promise<void>){const current=scope.current;setBusy(true);setError('');setNotice('');try{await work();if(scope.current===current)await load();}catch(e){if(scope.current===current)setError((e as Error).message);}finally{setBusy(false);}}
  async function signIn(e:React.FormEvent){e.preventDefault();if(!auth)return;setBusy(true);setError('');const {error}=await auth.auth.signInWithPassword({email,password});setPassword('');if(error)setError('Sign-in failed. Check your account details.');setBusy(false);}
  async function ask(e:React.FormEvent){e.preventDefault();if(!question.trim()||sending)return;const current=scope.current;setSending(true);setError('');
    try{
      let id=conversation;if(!id){id=(await api(`/teams/${teamId}/conversations`,{method:'POST'})).id;if(scope.current!==current)return;setConversation(id);}
      const q=question.trim();if(!pending.current||pending.current.question!==q||pending.current.conversation!==id)pending.current={question:q,key:crypto.randomUUID(),conversation:id};
      await api(`/teams/${teamId}/conversations/${id}/messages`,{method:'POST',body:JSON.stringify({question:q,idempotencyKey:pending.current.key})});
      if(scope.current!==current)return;pending.current=null;setQuestion('');setMessages(await api(`/teams/${teamId}/conversations/${id}/messages`));setConversations(await api(`/teams/${teamId}/conversations`));
    }catch(e){if(scope.current===current)setError((e as Error).message);}finally{setSending(false);}}
  async function upload(){if(!file)return;if(file.size>20*1024*1024)throw new Error('Maximum file size is 20 MiB');const data=new FormData();data.set('file',file);if(title)data.set('title',title);
    await api(`/teams/${teamId}/documents${versionDoc?`/${versionDoc.id}/versions`:''}`,{method:'POST',body:data});setFile(null);setTitle('');setNotice('Uploaded privately. Processing is queued.');}
  async function download(doc:Doc,version:any){const current=scope.current;const response:Response=await api(`/teams/${teamId}/documents/${doc.id}/versions/${version.id}/download`);
    const bytes=await response.blob();if(scope.current!==current)return;
    const url=URL.createObjectURL(bytes);const anchor=document.createElement('a');anchor.href=url;anchor.download=version.filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const banner=<>{error&&<div className="alert error" role="alert">{error}</div>}{notice&&<div className="alert" role="status">{notice}</div>}</>;
  if(!session)return <main className="login"><div className="brand"><span className="brand-mark">T</span>TechCo<span className="muted"> / Team Assistant</span></div>
    <section className="login-card"><div className="eyebrow">YOUR TEAM’S KNOWLEDGE, IN ONE PLACE</div><h1>Welcome to your<br/>private workspace.</h1><p>Ask questions, find trusted sources, and keep your team’s documents together.</p>
      {!auth&&<div className="alert">Authentication setup is required. Configure the public Supabase settings in the frontend environment file.</div>}{banner}
      <form onSubmit={signIn}><label>Email<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
        <button disabled={!auth||busy}>{busy?'Signing in…':'Sign in →'}</button></form><p className="small muted">Access follows your current team membership. Ask your administrator for an account.</p></section></main>;
  return <div className="workspace"><aside><div className="brand"><span className="brand-mark">T</span>TechCo</div><div className="eyebrow">WORKSPACE</div>
    <select aria-label="Active team" value={teamId} onChange={e=>{clear();setTeamId(e.target.value);setError('');setNotice('');}}><option value="">Select a team</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
    <nav>{['Chat','Documents',...(team?.role==='admin'?['Admin']:[])].map(name=><button className={tab===name?'nav active':'nav'} key={name} onClick={()=>{setTab(name);setCitation(null);setError('');}}><span>{name==='Chat'?'◌':name==='Documents'?'▤':'⚙'}</span>{name}</button>)}</nav>
    <div className="sidebar-bottom"><span className="badge">{team?.role||'No membership'}</span><p className="small">{session.user.email}</p><button className="secondary" onClick={()=>{clear();setProfile(null);setTeams([]);setTeamId('');setSession(null);void auth?.auth.signOut();}}>Sign out</button></div></aside>
    <main className="content"><header><div><div className="eyebrow">{team?.name||'YOUR WORKSPACE'}</div><h1>{tab==='Chat'?'Ask your team’s knowledge.':tab==='Documents'?'Your document library.':'Manage your team.'}</h1></div><button className="secondary" onClick={()=>void load()} disabled={busy}>Refresh</button></header>{banner}
      {!team&&<section className="panel empty"><h2>No active team membership</h2><p>Sign in with a provisioned account and ask an administrator to add your profile to a team.</p><p className="small">Share your profile ID with your team administrator: <code>{profile?.id}</code></p></section>}
      {team&&tab==='Chat'&&<div className="chat-layout"><section className="panel conversations"><button className="secondary full" onClick={()=>{setConversation('');setMessages([]);pending.current=null;setCitation(null);}}>＋ New conversation</button>
        {conversations.map(c=><button key={c.id} className={conversation===c.id?'conversation selected':'conversation'} onClick={()=>{setConversation(c.id);setMessages([]);setCitation(null);pending.current=null;}}>{c.title}</button>)}
        {!!conversation&&<button className="text-button danger" onClick={()=>void action(async()=>{await api(`/teams/${teamId}/conversations/${conversation}`,{method:'DELETE'});setConversation('');setMessages([]);})}>Delete conversation</button>}</section>
        <section className="panel chat"><div className="thread">{!messages.length&&<div className="empty"><div className="orb">✧</div><h2>What would you like to know?</h2><p>Answers use the documents you can currently read, with sources you can inspect.</p></div>}
          {messages.map(m=><article key={m.id} className={`message ${m.role}`}><div className="eyebrow">{m.role==='user'?'YOU':'ASSISTANT'}</div>
            {m.role==='assistant'&&m.available===false?<p className="muted">This answer is unavailable because its sources are no longer accessible.</p>:<>
              <p className="answer">{m.text||m.answer}</p>{m.citations?.map(c=><button className="source" key={c.label} onClick={()=>void action(async()=>{setCitation(await api(`/teams/${teamId}/messages/${m.id}/sources/${c.label}`));})}>{c.label} · {c.title}{c.historical?' · historical':''}</button>)}
              {m.role==='assistant'&&<div className="ratings"><input aria-label="Optional feedback comment" maxLength={2000} placeholder="Optional feedback comment" value={feedbackComments[m.id]||''} onChange={e=>setFeedbackComments(old=>({...old,[m.id]:e.target.value}))}/><button className="text-button" onClick={()=>void action(async()=>{await api(`/teams/${teamId}/messages/${m.id}/feedback`,{method:'PATCH',body:JSON.stringify({rating:'helpful',comment:feedbackComments[m.id]||undefined})});setNotice('Feedback saved.');})}>Helpful</button><button className="text-button" onClick={()=>void action(async()=>{await api(`/teams/${teamId}/messages/${m.id}/feedback`,{method:'PATCH',body:JSON.stringify({rating:'unhelpful',comment:feedbackComments[m.id]||undefined})});setNotice('Feedback saved.');})}>Unhelpful</button></div>}</>}</article>)}
          {sending&&<p className="muted" role="status">Finding sources and preparing an answer…</p>}</div>
          <form className="composer" onSubmit={ask}><textarea aria-label="Question" value={question} maxLength={8000} onChange={e=>setQuestion(e.target.value)} placeholder={`Ask a question about ${team.name} documents…`} disabled={sending}/><button disabled={sending||!question.trim()}>{sending?'Working…':'Ask →'}</button></form>
          <p className="small muted">Check the cited sources. AI answers can contain mistakes.</p></section></div>}
      {team&&tab==='Documents'&&<><div className="toolbar"><input aria-label="Search authorized documents" placeholder="Search your documents…" value={search} onChange={e=>setSearch(e.target.value)}/><span className="muted small">Private files · PDF & TXT · 20 MiB maximum</span></div>
        {team.role!=='viewer'&&<section className="panel upload"><h2>{versionDoc?`New version: ${versionDoc.title}`:'Upload a document'}</h2><p className="muted small">New documents start restricted to your membership. An administrator can change access.</p><div className="form-row"><input placeholder="Document title (optional)" value={title} onChange={e=>setTitle(e.target.value)}/><input type="file" accept=".pdf,.txt" onChange={e=>setFile(e.target.files?.[0]||null)}/><button disabled={!file||busy} onClick={()=>void action(upload)}>Upload</button>{versionDoc&&<button className="secondary" onClick={()=>setVersionDoc(null)}>Cancel</button>}</div></section>}
        <section className="panel"><table><thead><tr><th>Document</th><th>Access</th><th>Status</th><th>Actions</th></tr></thead><tbody>{docs.map(d=><tr key={d.id}><td><strong>{d.title}</strong></td><td><span className="badge">{d.visibility}</span></td><td><span className={`status ${d.status}`}>{d.status.replaceAll('_',' ')}</span></td><td className="actions"><button className="text-button" onClick={()=>void action(async()=>{await navigator.clipboard.writeText(d.id);setNotice('Document ID copied. Share it with your team administrator.');})}>Copy ID</button><button className="text-button" onClick={()=>void action(async()=>{setVersions(await api(`/teams/${teamId}/documents/${d.id}/versions`));setVersionDoc(d);})}>Versions</button>
          {team.role!=='viewer'&&<><button className="text-button" onClick={()=>{setVersionDoc(d);setFile(null);}}>Update</button><button className="text-button danger" onClick={()=>{if(window.confirm('Delete this document and make its dependent answers unavailable?'))void action(async()=>{await api(`/teams/${teamId}/documents/${d.id}`,{method:'DELETE'});setVersions([]);setVersionDoc(null);});}}>Delete</button></>}</td></tr>)}</tbody></table>{!docs.length&&<div className="empty">No readable documents match.</div>}<div className="form-row"><button className="secondary" disabled={documentOffset===0||busy} onClick={()=>setDocumentOffset(old=>Math.max(0,old-100))}>Previous</button><span className="small muted">Page {Math.floor(documentOffset/100)+1}</span><button className="secondary" disabled={docs.length<100||busy||documentOffset>=10000} onClick={()=>setDocumentOffset(old=>old+100)}>Next</button></div></section>
        {versionDoc&&versions.length>0&&<section className="panel"><h2>Versions · {versionDoc.title}</h2>{versions.map(v=><div className="version-row" key={v.id}><span>v{v.versionNumber} · {v.filename}</span><span className="badge">{v.status}</span><button className="secondary" onClick={()=>void action(()=>download(versionDoc,v))}>Download</button></div>)}</section>}</>}
      {team&&tab==='Admin'&&team.role==='admin'&&<><div className="admin-grid"><section className="panel"><div className="eyebrow">MONTHLY ANSWERS · UTC</div><h2 className="metric">{usage?.used||0}<span> / {usage?.limit??'—'}</span></h2><p className="muted">{usage?.held||0} reserved · successful saved answers</p><div className="form-row"><input aria-label="Monthly answer limit" type="number" min={0} max={1000000} value={budget} onChange={e=>setBudget(Number(e.target.value))}/><button disabled={busy} onClick={()=>void action(async()=>{await api(`/teams/${teamId}/admin/budget`,{method:'PATCH',body:JSON.stringify({limit:budget})});setNotice('Budget updated and audited.');})}>Set limit</button></div></section>
        <section className="panel"><h2>Grant access by document ID</h2><p className="muted small">An uploader can share the document ID. Access changes are explicit and audited; restricted documents are not listed here unless you can read them.</p><input placeholder="Document UUID" value={grantDoc} onChange={e=>setGrantDoc(e.target.value)}/><select value={grantMember} onChange={e=>setGrantMember(e.target.value)}><option value="">Choose a current member</option>{members.filter(m=>!m.removedAt).map(m=><option key={m.id} value={m.id}>{m.displayName} · {m.role}</option>)}</select><div className="form-row"><button disabled={busy||!grantDoc||!grantMember} onClick={()=>void action(async()=>{await api(`/teams/${teamId}/documents/${grantDoc}/grants`,{method:'POST',body:JSON.stringify({membershipId:grantMember})});setNotice('Access change submitted.');})}>Grant read</button><button className="secondary" disabled={busy||!grantDoc||!grantMember} onClick={()=>void action(async()=>{await api(`/teams/${teamId}/documents/${grantDoc}/grants/${grantMember}`,{method:'DELETE'});setNotice('Access change submitted.');})}>Revoke</button></div></section></div>
        <section className="panel"><h2>Members & roles</h2><div className="form-row"><input placeholder="Existing user profile UUID" value={targetUser} onChange={e=>setTargetUser(e.target.value)}/><select value={newRole} onChange={e=>setNewRole(e.target.value)}>{['viewer','editor','admin'].map(r=><option key={r}>{r}</option>)}</select><button disabled={busy||!targetUser} onClick={()=>void action(async()=>{await api(`/teams/${teamId}/members`,{method:'POST',body:JSON.stringify({userId:targetUser,role:newRole})});setTargetUser('');})}>Add member</button></div>
          <table><thead><tr><th>Member</th><th>Role</th><th>Status</th><th/></tr></thead><tbody>{members.map(m=><tr key={m.id}><td>{m.displayName}</td><td><select disabled={!!m.removedAt||busy} value={m.role} onChange={e=>void action(async()=>{await api(`/teams/${teamId}/members/${m.id}`,{method:'PATCH',body:JSON.stringify({role:e.target.value})});})}>{['viewer','editor','admin'].map(role=><option key={role}>{role}</option>)}</select></td><td>{m.removedAt?'Removed':'Active'}</td><td>{!m.removedAt&&<button className="text-button danger" onClick={()=>{if(window.confirm('Remove this membership and its restricted grants?'))void action(async()=>{await api(`/teams/${teamId}/members/${m.id}`,{method:'DELETE'});});}}>Remove</button>}</td></tr>)}</tbody></table></section>
        <section className="panel"><h2>Document visibility</h2><p className="muted small">Switching to restricted replaces the readers with the explicitly selected membership below.</p>{docs.map(d=><div className="version-row" key={d.id}><span>{d.title}</span><span className="badge">{d.visibility}</span><button className="secondary" disabled={busy} onClick={()=>void action(async()=>{await api(`/teams/${teamId}/documents/${d.id}/visibility`,{method:'PATCH',body:JSON.stringify({visibility:'team',readers:[]})});})}>Team-visible</button><button className="secondary" disabled={busy||!grantMember} onClick={()=>void action(async()=>{await api(`/teams/${teamId}/documents/${d.id}/visibility`,{method:'PATCH',body:JSON.stringify({visibility:'restricted',readers:[grantMember]})});})}>Restrict to selected reader</button></div>)}</section>
        <section className="panel"><h2>Permitted audit records</h2><table><thead><tr><th>Time</th><th>Action</th><th>Target</th></tr></thead><tbody>{audit.map(a=><tr key={a.id}><td>{new Date(a.occurred_at).toLocaleString()}</td><td>{a.action}</td><td className="small">{a.target_type} · {a.target_id?.slice(0,8)||'—'}</td></tr>)}</tbody></table></section></>}
    </main>{citation&&<div className="modal-backdrop" onClick={()=>setCitation(null)}><section className="panel citation" role="dialog" aria-modal="true" aria-label="Authorized source" onClick={e=>e.stopPropagation()}><button className="secondary close" onClick={()=>setCitation(null)}>Close</button><div className="eyebrow">AUTHORIZED SOURCE{citation.historical?' · HISTORICAL VERSION':''}</div><h2>{citation.title}</h2><p className="small muted">{citation.locationKind==='page'?`Pages ${citation.pageStart}–${citation.pageEnd}`:`Lines ${citation.lineStart}–${citation.lineEnd}`}</p><p className="answer">{citation.text}</p></section></div>}</div>;
}
