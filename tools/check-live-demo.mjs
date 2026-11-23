/** Opt-in real-service demo. Creates one synthetic handbook; never resets existing data. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

if (!process.argv.includes('--run')) {
  console.log('Opt in with node --env-file=.env tools/check-live-demo.mjs --run. Uses real services and one synthetic saved answer.');
  process.exit(0);
}
const base = new URL(process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001');
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password) {
  console.error('Expected the configured loopback API. No credentials were sent.');
  process.exit(1);
}
const hr = '30000000-0000-4000-8000-000000000001';
const eng = '30000000-0000-4000-8000-000000000002';
const saraMembership = '40000000-0000-4000-8000-000000000002';
const source = readFileSync('demo-files/TechCo HR Handbook.txt');
const accounts = [...readFileSync('.tmp/demo-login-credentials.txt', 'utf8').matchAll(/^(Ali|Sara|Hina|Ahmed)\r?\nEmail: ([^\r\n]+)\r?\nPassword: ([^\r\n]+)/gm)];
const clients = new Map();
const tokens = new Map();
const evidence = { date: '2026-11-21', timezone: 'Asia/Karachi', layer: 'Running production API, native PostgreSQL, Docker Redis/BullMQ, Supabase Auth/Storage, Gemini and Groq',
  syntheticDataOnly: true, checks: [], demoHandbookRetained: false, temporaryGrantRemoved: false, testConversationPurged: false,
  limits: ['This is one synthetic live scenario, not a full adversarial model or outage-recovery evaluation.', 'A successful saved answer consumes an application quota slot; deletion does not refund it.', 'Browser automation is separate; this runner uses authenticated HTTP.'] };
let stage = 'readiness';
let document;
let conversation;
let granted = false;
let failure;
function check(name, condition) {
  stage = name;
  if (!condition) throw new Error('ASSERTION_FAILED');
  evidence.checks.push({ name, passed: true });
  console.log('PASS ' + name);
}
async function api(person, path, { method = 'GET', json, form, expected = 200, bytes = false } = {}) {
  const headers = {};
  if (person) headers.Authorization = 'Bearer ' + tokens.get(person);
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(path, base), { method, headers, body: form || (json === undefined ? undefined : JSON.stringify(json)), signal: AbortSignal.timeout(65000) });
  if (response.status !== expected) { evidence.lastSafeRequestId = response.headers.get('x-request-id'); throw new Error('HTTP_' + response.status); }
  return bytes ? Buffer.from(await response.arrayBuffer()) : response.json();
}
function uploadForm() {
  const form = new FormData();
  form.set('file', new Blob([source], { type: 'text/plain' }), 'TechCo HR Handbook.txt');
  form.set('title', 'TechCo HR Handbook');
  return form;
}
try {
  check('Running API health', (await api(null, '/health')).status === 'ok');
  if (accounts.length !== 4) throw new Error('PRIVATE_ACCOUNT_FILE_INVALID');
  for (const account of accounts) {
    const name = account[1].toLowerCase(); stage = 'Real login for ' + name;
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } });
    clients.set(name, client);
    const { data, error } = await client.auth.signInWithPassword({ email: account[2].trim(), password: account[3] });
    if (error || !data.session) throw new Error('AUTH_FAILED');
    tokens.set(name, data.session.access_token);
    const teams = await api(name, '/teams');
    const actual = teams.map(team => `${team.id}:${team.role}`).sort();
    const expected = { ali: [`${hr}:viewer`], sara: [`${hr}:editor`, `${eng}:viewer`].sort(), hina: [`${hr}:admin`], ahmed: [`${eng}:admin`] }[name];
    check('Live identity/current roles: ' + name, JSON.stringify(actual) === JSON.stringify(expected));
  }
  const documents = await api('hina', `/teams/${hr}/documents`);
  if (documents.some(row => row.title === 'TechCo HR Handbook')) throw new Error('HANDBOOK_ALREADY_EXISTS_PRESERVED');
  stage = 'Private handbook upload';
  document = await api('hina', `/teams/${hr}/documents`, { method: 'POST', form: uploadForm(), expected: 201 });
  writeFileSync('.tmp/live-demo-last.json', JSON.stringify({ documentId: document.id, versionId: document.versionId }, null, 2) + '\n');
  check('Real private Storage upload accepted', Boolean(document.id && document.versionId));
  stage = 'Actual BullMQ/worker embedding pipeline';
  let ready = false;
  for (let attempt = 0; attempt < 35; attempt++) {
    const versions = await api('hina', `/teams/${hr}/documents/${document.id}/versions`);
    const version = versions.find(row => row.id === document.versionId);
    if (version?.status === 'ready') { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  check('Real worker/Supabase/Gemini pipeline reached ready', ready);
  const download = `/teams/${hr}/documents/${document.id}/versions/${document.versionId}/download`;
  const original = await api('hina', download, { bytes: true });
  check('Authorized original download matches uploaded bytes', createHash('sha256').update(original).digest('hex') === createHash('sha256').update(source).digest('hex'));
  const aliDocuments = await api('ali', `/teams/${hr}/documents`);
  check('Restricted handbook hidden from Ali list', !aliDocuments.some(row => row.id === document.id));
  await api('ali', download, { expected: 404 }); check('Known-version direct download denied to Ali', true);
  await api('ali', `/teams/${hr}/documents`, { method: 'POST', form: uploadForm(), expected: 403 }); check('Ali viewer upload denied by backend', true);
  await api('sara', `/teams/${eng}/documents`, { method: 'POST', form: uploadForm(), expected: 403 }); check('Sara Engineering viewer upload denied', true);
  await api('ahmed', `/teams/${hr}/documents`, { expected: 403 }); check('Engineering admin cannot enter HR', true);
  stage = 'Explicit restricted read grant';
  await api('hina', `/teams/${hr}/documents/${document.id}/grants`, { method: 'POST', json: { membershipId: saraMembership }, expected: 201 });
  granted = true;
  check('Explicit grant enables Sara original download', (await api('sara', download, { bytes: true })).equals(source));
  const before = await api('hina', `/teams/${hr}/admin/usage`);
  stage = 'Private conversation creation';
  conversation = await api('sara', `/teams/${hr}/conversations`, { method: 'POST', json: {}, expected: 201 });
  const request = { question: 'According to the TechCo HR Handbook, how many working days of annual leave does an employee receive per calendar year?', idempotencyKey: 'live-demo-' + randomUUID() };
  stage = 'Real authorized retrieval and Groq cited answer';
  const answer = await api('sara', `/teams/${hr}/conversations/${conversation.id}/messages`, { method: 'POST', json: request, expected: 201 });
  check('Real RAG answer has the handbook fact and citations', answer.available === true && answer.kind === 'grounded' && /\b20\b|twenty/i.test(answer.answer) && answer.citations?.length > 0);
  const citationPath = `/teams/${hr}/messages/${answer.id}/sources/${answer.citations[0].label}`;
  const citation = await api('sara', citationPath);
  check('Live citation returns supporting original excerpt', JSON.stringify(citation).includes('20 working days'));
  const replay = await api('sara', `/teams/${hr}/conversations/${conversation.id}/messages`, { method: 'POST', json: request, expected: 201 });
  check('Idempotent replay returns the same saved answer', replay.id === answer.id && replay.answer === answer.answer);
  const after = await api('hina', `/teams/${hr}/admin/usage`);
  check('Successful answer appears in team quota usage', after.used >= before.used + 1 && after.held === 0);
  await api('hina', `/teams/${hr}/conversations/${conversation.id}/messages`, { expected: 404 }); check('Admin cannot read Sara private conversation', true);
  stage = 'Grant revocation';
  await api('hina', `/teams/${hr}/documents/${document.id}/grants/${saraMembership}`, { method: 'DELETE' });
  granted = false; evidence.temporaryGrantRemoved = true;
  const history = await api('sara', `/teams/${hr}/conversations/${conversation.id}/messages`);
  const hidden = history.find(row => row.id === answer.id);
  check('Revocation hides the complete old assistant answer', hidden?.available === false && !hidden.answer && !hidden.citations);
  await api('sara', citationPath, { expected: 404 }); check('Revocation denies the old citation', true);
  await api('sara', download, { expected: 404 }); check('Revocation denies original download immediately', true);
  stage = 'Prepare retained shared handbook for learner';
  await api('hina', `/teams/${hr}/documents/${document.id}/visibility`, { method: 'PATCH', json: { visibility: 'team', readers: [] } });
  check('Explicit team visibility enables Ali viewer read', (await api('ali', download, { bytes: true })).equals(source));
  const audit = await api('hina', `/teams/${hr}/admin/audit`);
  check('Admin audit records are available', Array.isArray(audit) && audit.length > 0);
  evidence.demoHandbookRetained = true;
  evidence.finalHandbookVisibility = 'team (explicit Hina admin action after restricted-access tests)';
} catch (error) {
  failure = { stage, code: /^(HTTP_[0-9]+|ASSERTION_FAILED|AUTH_FAILED|PRIVATE_ACCOUNT_FILE_INVALID|HANDBOOK_ALREADY_EXISTS_PRESERVED)$/.test(error.message) ? error.message : 'LIVE_CHECK_FAILED' };
} finally {
  if (granted && document) {
    try { await api('hina', `/teams/${hr}/documents/${document.id}/grants/${saraMembership}`, { method: 'DELETE' }); evidence.temporaryGrantRemoved = true; } catch {}
  }
  if (conversation) {
    try { await api('sara', `/teams/${hr}/conversations/${conversation.id}`, { method: 'DELETE' }); evidence.testConversationPurged = true; } catch {}
  }
  for (const client of clients.values()) { try { await client.auth.signOut({ scope: 'local' }); } catch {} }
  evidence.success = !failure;
  if (failure) evidence.failure = failure;
  writeFileSync('docs/live-demo-run.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ success: evidence.success, checksPassed: evidence.checks.length, handbookReadyForLearner: evidence.demoHandbookRetained,
    testConversationPurged: evidence.testConversationPurged, failure, credentialsOrFileBodiesPrinted: false }));
  if (failure) process.exitCode = 1;
}
