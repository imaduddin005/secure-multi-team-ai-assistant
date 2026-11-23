/** Opt-in synthetic Engineering practice upload using the normal running services. */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

if (!process.argv.includes('--run')) {
  console.log('Use node --env-file=.env tools/check-live-engineering.mjs --run --with-sara. Real services; synthetic demo file only.');
  process.exit(0);
}
const withSara = process.argv.includes('--with-sara');
const base = new URL(process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password) {
  throw new Error('Expected the configured loopback API; no credentials were sent.');
}
const hr = '30000000-0000-4000-8000-000000000001';
const eng = '30000000-0000-4000-8000-000000000002';
const title = 'TechCo Engineering Handbook';
const source = readFileSync('demo-files/TechCo Engineering Handbook.txt');
const accounts = [...readFileSync('.tmp/demo-login-credentials.txt', 'utf8').matchAll(/^(Ali|Sara|Hina|Ahmed)\r?\nEmail: ([^\r\n]+)\r?\nPassword: ([^\r\n]+)/gm)];
const tokens = new Map(), clients = new Map(), conversations = [];
const evidence = { date: '2026-11-23', timezone: 'Asia/Karachi', syntheticDataOnly: true,
  layer: 'Normal running API, PostgreSQL, Supabase Auth/private Storage, Redis/BullMQ worker, Gemini and Groq',
  checks: [], pending: [], cleanup: {}, limitations: [
    'The fictional handbook is a question source, not proof that CI, release automation or incident operations are implemented.',
    'Saved grounded test answers use the real application quota; deletion does not refund them.',
    'This is authenticated HTTP, not an automated live-browser or fault-injection run.'
  ] };
let stage = 'readiness', failure, document, originalRoles;
const check = (name, condition) => {
  stage = name;
  if (!condition) throw new Error('ASSERTION_FAILED');
  evidence.checks.push({ name, passed: true }); console.log('PASS ' + name);
};
async function api(person, path, { method = 'GET', json, form, expected = 200, bytes = false } = {}) {
  const headers = {};
  if (person) headers.Authorization = 'Bearer ' + tokens.get(person);
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(path, base), { method, headers,
    body: form || (json === undefined ? undefined : JSON.stringify(json)), signal: AbortSignal.timeout(90000) });
  if (response.status !== expected) { evidence.lastSafeRequestId = response.headers.get('x-request-id'); throw new Error('HTTP_' + response.status); }
  return bytes ? Buffer.from(await response.arrayBuffer()) : response.json();
}
function form() {
  const value = new FormData(); value.set('title', title);
  value.set('file', new Blob([source], { type: 'text/plain' }), 'TechCo Engineering Handbook.txt'); return value;
}
async function login(person) {
  const account = accounts.find(row => row[1].toLowerCase() === person);
  if (!account) throw new Error('PRIVATE_ACCOUNT_MISSING');
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } });
  clients.set(person, client);
  const { data, error } = await client.auth.signInWithPassword({ email: account[2].trim(), password: account[3] });
  if (error || !data.session) throw new Error('AUTH_FAILED'); tokens.set(person, data.session.access_token);
  return api(person, '/teams');
}
const roles = rows => rows.filter(row => !row.removedAt).map(row => ({ id: row.id, name: row.displayName, role: row.role })).sort((a, b) => a.id.localeCompare(b.id));
async function conversation(person) {
  const value = await api(person, `/teams/${eng}/conversations`, { method: 'POST', json: { title: 'Engineering practice verification' }, expected: 201 });
  conversations.push({ person, id: value.id }); return value.id;
}
async function ask(person, id, question, key = 'engineering-' + randomUUID()) {
  return api(person, `/teams/${eng}/conversations/${id}/messages`, { method: 'POST', json: { question, idempotencyKey: key }, expected: 201 });
}
try {
  check('Running API health', (await api(null, '/health')).status === 'ok');
  const ahmedTeams = await login('ahmed');
  check('Ahmed is the current Engineering administrator', ahmedTeams.length === 1 && ahmedTeams[0].id === eng && ahmedTeams[0].role === 'admin');
  originalRoles = roles(await api('ahmed', `/teams/${eng}/members`));
  check('Engineering has Ahmed admin, Sara viewer and no editor', originalRoles.length === 2 && originalRoles.some(m => m.name === 'Ahmed' && m.role === 'admin') && originalRoles.some(m => m.name === 'Sara' && m.role === 'viewer') && !originalRoles.some(m => m.role === 'editor'));
  evidence.engineeringRoles = originalRoles.map(({ name, role }) => ({ name, role }));
  const documents = await api('ahmed', `/teams/${eng}/documents`);
  const existing = documents.find(row => row.title === title);
  if (existing) {
    const versions = await api('ahmed', `/teams/${eng}/documents/${existing.id}/versions`);
    const ready = versions.find(row => row.isCurrent) || versions.find(row => row.status === 'ready');
    if (!ready) throw new Error('EXISTING_DOCUMENT_PRESERVED');
    const original = await api('ahmed', `/teams/${eng}/documents/${existing.id}/versions/${ready.id}/download`, { bytes: true });
    if (!original.equals(source)) throw new Error('EXISTING_DOCUMENT_PRESERVED');
    document = { id: existing.id, versionId: ready.id }; evidence.provisioning = 'Existing matching original preserved.';
  } else {
    stage = 'Private Engineering upload';
    document = await api('ahmed', `/teams/${eng}/documents`, { method: 'POST', form: form(), expected: 201 });
    evidence.provisioning = 'New synthetic Engineering document uploaded by Ahmed.';
  }
  check('Ahmed upload provides an immutable document/version identity', !!document.id && !!document.versionId);
  writeFileSync('.tmp/live-engineering-document.json', JSON.stringify(document, null, 2) + '\n');
  stage = 'Normal background processing';
  let ready = false;
  for (let attempt = 0; attempt < 65; attempt++) {
    const versions = await api('ahmed', `/teams/${eng}/documents/${document.id}/versions`);
    const version = versions.find(row => row.id === document.versionId);
    if (version?.status === 'ready') { ready = true; break; }
    if (version?.status === 'failed') throw new Error('WORKER_FAILED');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  check('Real Redis worker and Gemini processed Engineering file to ready', ready);
  const download = `/teams/${eng}/documents/${document.id}/versions/${document.versionId}/download`;
  check('Engineering original matches the supplied synthetic bytes', (await api('ahmed', download, { bytes: true })).equals(source));
  await api('ahmed', `/teams/${eng}/documents/${document.id}/visibility`, { method: 'PATCH', json: { visibility: 'team', readers: [] } });
  check('Ahmed explicitly made the practice file Engineering-team visible', (await api('ahmed', `/teams/${eng}/documents`)).some(row => row.id === document.id && row.visibility === 'team'));
  evidence.practiceFileReady = true; evidence.finalVisibility = 'Engineering team';
  await login('ali');
  await api('ali', `/teams/${eng}/documents`, { expected: 403 }); check('HR viewer Ali cannot list Engineering documents', true);
  await api('ali', download, { expected: 403 }); check('Known Engineering original URL does not bypass Ali team boundary', true);
  await api('ahmed', `/teams/${hr}/documents`, { expected: 403 }); check('Engineering administrator Ahmed cannot enter HR', true);
  const before = await api('ahmed', `/teams/${eng}/admin/usage`);
  const id = await conversation('ahmed');
  const question = 'According to the TechCo Engineering Handbook, how many minutes does the on-call engineer have to acknowledge a critical incident? Cite the source.';
  const key = 'engineering-admin-' + randomUUID();
  const answer = await ask('ahmed', id, question, key);
  check('Real Engineering RAG answers 15 minutes with citations', answer.available === true && answer.kind === 'grounded' && /\b15\b|fifteen/i.test(answer.answer) && answer.citations?.length > 0);
  const citation = await api('ahmed', `/teams/${eng}/messages/${answer.id}/sources/${answer.citations[0].label}`);
  check('Engineering citation exposes the authorized supporting excerpt', citation.text?.includes('15 minutes'));
  await api('ahmed', `/teams/${eng}/messages/${answer.id}/feedback`, { method: 'PATCH', json: { rating: 'helpful', comment: 'Synthetic Engineering practice verification.' } });
  check('Real answer feedback is accepted for the owning administrator', true);
  check('Engineering same-key replay returns the same saved message', (await ask('ahmed', id, question, key)).id === answer.id);
  const after = await api('ahmed', `/teams/${eng}/admin/usage`);
  check('Saved Engineering answer is reflected in application quota', after.used >= before.used + 1 && after.held === 0);
  check('Engineering administrator can inspect audit records', Array.isArray(await api('ahmed', `/teams/${eng}/admin/audit`)));
  if (withSara) {
    const saraTeams = await login('sara');
    check('Sara remains Engineering viewer and HR editor', saraTeams.some(t => t.id === eng && t.role === 'viewer') && saraTeams.some(t => t.id === hr && t.role === 'editor'));
    check('Sara viewer sees the shared Engineering practice file', (await api('sara', `/teams/${eng}/documents`)).some(row => row.id === document.id));
    check('Sara viewer can download the Engineering original', (await api('sara', download, { bytes: true })).equals(source));
    await api('sara', `/teams/${eng}/documents`, { method: 'POST', form: form(), expected: 403 }); check('Sara viewer upload is rejected by the backend', true);
    await api('sara', `/teams/${eng}/admin/usage`, { expected: 403 }); check('Sara viewer cannot open Engineering administration', true);
    const saraConversation = await conversation('sara');
    const saraAnswer = await ask('sara', saraConversation, 'According to the TechCo Engineering Handbook, how many approvals from another engineer are required before merging a pull request? Cite the source.');
    check('Sara viewer gets the one-approval fact with a real citation', saraAnswer.kind === 'grounded' && /\b1\b|\bone\b/i.test(saraAnswer.answer) && saraAnswer.citations?.length > 0);
    await api('ahmed', `/teams/${eng}/conversations/${saraConversation}/messages`, { expected: 404 }); check('Engineering admin cannot read Sara private chat', true);
    evidence.viewerChecksPassed = true;
  } else evidence.pending.push('Fresh Sara viewer HTTP checks were not requested in this run; use --with-sara after private credentials are configured.');
} catch (error) {
  failure = { stage, code: /^(HTTP_[0-9]+|ASSERTION_FAILED|AUTH_FAILED|PRIVATE_ACCOUNT_MISSING|EXISTING_DOCUMENT_PRESERVED|WORKER_FAILED)$/.test(error.message) ? error.message : 'ENGINEERING_CHECK_FAILED' };
} finally {
  let purged = 0;
  for (const row of conversations) { try { await api(row.person, `/teams/${eng}/conversations/${row.id}`, { method: 'DELETE' }); purged++; } catch {} }
  evidence.cleanup.testConversationsCreated = conversations.length; evidence.cleanup.testConversationsPurged = purged;
  if (originalRoles) { try { evidence.cleanup.rolesPreserved = JSON.stringify(roles(await api('ahmed', `/teams/${eng}/members`))) === JSON.stringify(originalRoles); } catch {} }
  for (const client of clients.values()) { try { await client.auth.signOut({ scope: 'local' }); } catch {} }
  evidence.success = !failure && evidence.practiceFileReady === true && evidence.cleanup.rolesPreserved === true && purged === conversations.length;
  if (failure) evidence.failure = failure;
  evidence.status = evidence.success ? (evidence.pending.length ? 'core_passed_viewer_pending' : 'passed') : 'failed';
  writeFileSync('docs/live-engineering-run.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: evidence.status, checksPassed: evidence.checks.length, practiceFileReady: evidence.practiceFileReady || false, viewerChecksPassed: evidence.viewerChecksPassed || false, cleanup: evidence.cleanup, failure, credentialsOrFileBodiesPrinted: false }));
  if (!evidence.success) process.exitCode = 1;
}
