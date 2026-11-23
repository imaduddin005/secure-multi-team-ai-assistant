/** Opt-in real Salary Plan authorization and concurrent-request challenges. */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

if (!process.argv.includes('--run')) {
  console.log('Run with node --env-file=.env tools/check-live-challenges.mjs --run. Uses synthetic files and saved-answer quota slots; temporarily changes and restores the team budget.');
  process.exit(0);
}
const base = 'http://127.0.0.1:3001';
const hr = '30000000-0000-4000-8000-000000000001';
const eng = '30000000-0000-4000-8000-000000000002';
const salaryId = '50000000-0000-4000-8000-000000000002';
const hinaMember = '40000000-0000-4000-8000-000000000004';
const saraMember = '40000000-0000-4000-8000-000000000002';
const runId = 'challenge-' + randomUUID();
const salaryBytes = readFileSync('demo-files/Salary Plan.txt');
const records = [...readFileSync('.tmp/demo-login-credentials.txt', 'utf8').matchAll(/^(Ali|Sara|Hina|Ahmed)\r?\nEmail: ([^\r\n]+)\r?\nPassword: ([^\r\n]+)/gm)];
const clients = new Map(), tokens = new Map(), conversations = [];
const evidence = { date: '2026-11-21', timezone: 'Asia/Karachi', layer: 'Normal running API, real PostgreSQL/Redis worker/Supabase/Gemini/Groq',
  syntheticFilesOnly: true, checks: [], concurrency: {}, cleanup: {}, limitations: ['A real model answer is checked on a small synthetic example, not a broad model-safety corpus.',
    'Actual vendor call counts/billing are not measured; quota assertions inspect real PostgreSQL ledger rows.', 'Previously downloaded bytes/screenshots cannot be recalled by revocation.'] };
const sql = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
let stage = 'preflight', failure, originalLimit, originalRoles, initialUsage;
let lastTestLimit, budgetTouched = false, salaryGrant = false, memo;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, condition, details) {
  stage = name;
  if (!condition) throw new Error('ASSERTION_FAILED');
  evidence.checks.push({ name, passed: true, ...(details ? { details } : {}) });
  console.log('PASS ' + name);
}
async function raw(person, path, { method = 'GET', json, form, bytes = false, jwt } = {}) {
  const headers = {};
  const token = jwt || tokens.get(person);
  if (token) headers.Authorization = 'Bearer ' + token;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, { method, headers, body: form || (json === undefined ? undefined : JSON.stringify(json)), signal: AbortSignal.timeout(65000) });
  return { status: response.status, body: bytes ? Buffer.from(await response.arrayBuffer()) : await response.json(), requestId: response.headers.get('x-request-id') };
}
async function api(person, path, options = {}, expected = 200) {
  const response = await raw(person, path, options);
  if (response.status !== expected) { evidence.lastSafeRequestId = response.requestId; throw new Error('HTTP_' + response.status); }
  return response.body;
}
const teamPath = `/teams/${hr}`;
const salaryPath = `${teamPath}/documents/${salaryId}`;
function form(bytes, filename, title) {
  const value = new FormData(); value.set('file', new Blob([bytes], { type: 'text/plain' }), filename);
  if (title) value.set('title', title);
  return value;
}
async function waitReady(person, id, versionId) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const rows = await api(person, `${teamPath}/documents/${id}/versions`);
    if (rows.some(row => row.id === versionId && row.status === 'ready')) return;
    await delay(2000);
  }
  throw new Error('WORKER_NOT_READY');
}
async function newConversation(person) {
  const result = await api(person, `${teamPath}/conversations`, { method: 'POST', json: {} }, 201);
  conversations.push({ person, id: result.id }); return result.id;
}
const ask = (person, id, key, question) => raw(person, `${teamPath}/conversations/${id}/messages`, { method: 'POST', json: { question, idempotencyKey: key } });
async function ledger(keys) {
  const result = await sql.query(`SELECT r.idempotency_key,
    (SELECT count(*)::int FROM app.usage_attempts a WHERE a.reservation_id=r.id AND a.state='charged') AS charged,
    (SELECT count(*)::int FROM app.usage_attempts a WHERE a.reservation_id=r.id AND a.state='held') AS held,
    (SELECT count(*)::int FROM app.messages m WHERE m.request_id=r.id AND m.kind='assistant') AS answers
    FROM app.usage_reservations r WHERE r.team_id=$1 AND r.idempotency_key=ANY($2::text[])`, [hr, keys]);
  return { reservations: result.rows.length, charged: result.rows.reduce((n, row) => n + row.charged, 0),
    held: result.rows.reduce((n, row) => n + row.held, 0), answers: result.rows.reduce((n, row) => n + row.answers, 0) };
}
async function changeBudget(limit) {
  await api('hina', `${teamPath}/admin/budget`, { method: 'PATCH', json: { limit } });
  lastTestLimit = limit; budgetTouched = true;
}
async function restoreBudget() {
  if (!budgetTouched) return;
  const usage = await api('hina', `${teamPath}/admin/usage`);
  if (usage.limit !== lastTestLimit && usage.limit !== originalLimit) throw new Error('EXTERNAL_BUDGET_CHANGE_PRESERVED');
  await api('hina', `${teamPath}/admin/budget`, { method: 'PATCH', json: { limit: originalLimit } });
  budgetTouched = false;
}
async function pair(requests, limit) {
  let pending = requests.length;
  const tracked = requests.map(request => request.then(value => { pending--; return value; }, () => { pending--; return { status: 0, body: {} }; }));
  let maxHeld = 0, samples = 0, overLimit = false;
  while (pending) {
    const result = await sql.query("SELECT used_count::int AS used,held_count::int AS held FROM app.usage_periods WHERE team_id=$1 AND period_start=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'", [hr]);
    if (result.rows[0]) { const row = result.rows[0]; maxHeld = Math.max(maxHeld, row.held); overLimit ||= row.used + row.held > limit; samples++; }
    if (pending) await delay(50);
  }
  return { responses: await Promise.all(tracked), maxHeld, samples, overLimit };
}
try {
  check('Running API is healthy', (await api(null, '/health')).status === 'ok');
  if (records.length !== 4) throw new Error('ACCOUNT_FILE_INVALID');
  for (const record of records) {
    const name = record[1].toLowerCase(); stage = 'Real login: ' + name;
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } });
    clients.set(name, client);
    const { data, error } = await client.auth.signInWithPassword({ email: record[2], password: record[3] });
    if (error || !data.session) throw new Error('AUTH_FAILED');
    tokens.set(name, data.session.access_token);
  }
  await sql.connect(); await sql.query('SET ROLE app_owner'); await sql.query('SET default_transaction_read_only=on');
  check('Ledger observer targets the real demo cluster read-only', (await sql.query("SELECT current_setting('cluster_name') AS cluster")).rows[0].cluster === 'secure-assistant-demo');
  originalRoles = (await api('hina', `${teamPath}/members`)).filter(row => !row.removedAt).map(row => ({ id: row.id, role: row.role })).sort((a,b) => a.id.localeCompare(b.id));
  initialUsage = await api('hina', `${teamPath}/admin/usage`); originalLimit = initialUsage.limit;
  check('No unrelated answer is in flight before quota tests', initialUsage.held === 0);
  const docs = await api('hina', `${teamPath}/documents`);
  const salary = docs.find(row => row.id === salaryId);
  const initialReaders = await api('hina', salaryPath + '/readers');
  check('Salary Plan starts restricted with Hina as its only explicit reader', salary?.visibility === 'restricted' && initialReaders.length === 1 && initialReaders[0].membershipId === hinaMember);
  stage = 'Prepare the actual synthetic Salary Plan';
  let versions = await api('hina', salaryPath + '/versions');
  let versionId = salary.currentVersionId;
  if (!versions.length) {
    const uploaded = await api('hina', salaryPath + '/versions', { method: 'POST', form: form(salaryBytes, 'Salary Plan.txt') }, 201);
    versionId = uploaded.versionId; await waitReady('hina', salaryId, versionId);
    evidence.salaryProvisioning = 'Uploaded the supplied synthetic fixture into the previously empty seeded Salary Plan.';
  } else {
    if (!versionId) throw new Error('EXISTING_SALARY_VERSION_PRESERVED');
    evidence.salaryProvisioning = 'Existing original preserved and checked against the synthetic fixture.';
  }
  const download = salaryPath + `/versions/${versionId}/download`;
  check('Hina reads the real Salary Plan original', (await api('hina', download, { bytes: true })).equals(salaryBytes));
  for (const person of ['ali','sara']) {
    const search = await api(person, teamPath + '/documents?q=Salary');
    check(person + ': Salary Plan absent from search', !search.some(row => row.id === salaryId));
    await api(person, salaryPath + '/versions', {}, 404); check(person + ': known document ID does not expose versions', true);
    await api(person, download, {}, 404); check(person + ': known original URL is denied', true);
  }
  await api('ali', salaryPath + '/grants', { method: 'POST', json: { membershipId: '40000000-0000-4000-8000-000000000001' } }, 403);
  check('Ali viewer cannot manufacture a self-grant', true);
  await api('sara', salaryPath + '/grants', { method: 'POST', json: { membershipId: saraMember } }, 403);
  check('Sara editor cannot manufacture a self-grant', true);
  await api('sara', salaryPath + '/versions', { method: 'POST', form: form(salaryBytes, 'Salary Plan.txt') }, 404);
  check('HR editor cannot update Salary Plan without content read access', true);
  await api('ahmed', teamPath + '/documents', {}, 403); check('Ahmed Engineering admin cannot list HR documents', true);
  await api('ahmed', download, {}, 403); check('Ahmed Engineering admin cannot download HR Salary Plan', true);
  await api(null, download, {}, 401); check('Unauthenticated Salary Plan request is denied', true);
  const pieces = tokens.get('ali').split('.'); const payload = JSON.parse(Buffer.from(pieces[1], 'base64url').toString());
  payload.role = 'admin'; pieces[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  await api('ali', download, { jwt: pieces.join('.') }, 401); check('Tampered admin JWT does not bypass verification', true);
  const knownDenied = await raw('ali', download);
  const unknownDenied = await raw('ali', `${teamPath}/documents/${randomUUID()}/versions/${randomUUID()}/download`);
  check('Hidden and nonexistent downloads have the same neutral denial', knownDenied.status === unknownDenied.status && knownDenied.body.message === unknownDenied.body.message);
  const object = (await sql.query('SELECT i.object_key FROM app.storage_intents i JOIN app.document_versions v ON v.storage_intent_id=i.id WHERE v.id=$1', [versionId])).rows[0];
  for (const person of [null, 'ali']) {
    const encoded = object.object_key.split('/').map(encodeURIComponent).join('/');
    const route = person ? 'authenticated' : 'public';
    const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${route}/${encodeURIComponent(process.env.SUPABASE_PRIVATE_BUCKET || 'team-documents')}/${encoded}`,
      { headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, ...(person ? { Authorization: 'Bearer ' + tokens.get(person) } : {}) }, signal: AbortSignal.timeout(15000) });
    check((person || 'anonymous') + ': direct Supabase Storage bypass is denied', !response.ok); await response.body?.cancel();
  }
  const deniedConversation = await newConversation('ali'), deniedKey = runId + '-hidden-salary';
  stage = 'Ali asks the AI about hidden Salary Plan';
  const hiddenAsk = await ask('ali', deniedConversation, deniedKey, 'What is the fictional planning budget in Salary Plan, in training credits?');
  check('Ali AI response does not disclose the hidden Salary Plan value', hiddenAsk.status === 201 && hiddenAsk.body.kind === 'insufficient_sources' && !/\b120\b|one hundred and twenty/i.test(hiddenAsk.body.answer));
  const hiddenSources = await sql.query('SELECT count(*)::int AS n FROM app.message_sources s JOIN app.messages m ON m.id=s.message_id JOIN app.usage_reservations r ON r.id=m.request_id WHERE r.idempotency_key=$1 AND s.document_id=$2', [deniedKey, salaryId]);
  check('Ali recorded model-source provenance excludes Salary Plan', hiddenSources.rows[0].n === 0);
  stage = 'Temporarily grant Sara the real Salary Plan';
  await api('hina', salaryPath + '/grants', { method: 'POST', json: { membershipId: saraMember } }, 201); salaryGrant = true;
  check('Explicit grant enables Sara Salary Plan download', (await api('sara', download, { bytes: true })).equals(salaryBytes));
  const salaryConversation = await newConversation('sara'), salaryKey = runId + '-salary-answer';
  const salaryQuestion = 'According to Salary Plan, what is the fictional planning budget for the next review cycle, in training credits?';
  const salaryAnswer = await ask('sara', salaryConversation, salaryKey, salaryQuestion);
  check('Granted Sara gets a real cited Salary Plan answer', salaryAnswer.status === 201 && salaryAnswer.body.kind === 'grounded' && /\b120\b|one hundred and twenty/i.test(salaryAnswer.body.answer) && salaryAnswer.body.citations?.some(row => row.documentId === salaryId));
  const citationPath = `${teamPath}/messages/${salaryAnswer.body.id}/sources/${salaryAnswer.body.citations.find(row => row.documentId === salaryId).label}`;
  await api('sara', citationPath); check('Salary Plan citation works before revocation', true);
  await api('hina', salaryPath + '/grants/' + saraMember, { method: 'DELETE' }); salaryGrant = false;
  const history = await api('sara', `${teamPath}/conversations/${salaryConversation}/messages`);
  const unavailable = history.find(row => row.id === salaryAnswer.body.id);
  check('Salary grant revocation hides the old complete answer', unavailable?.available === false && !unavailable.answer && !unavailable.citations);
  await api('sara', citationPath, {}, 404); check('Revoked Salary Plan citation is denied', true);
  await api('sara', download, {}, 404); check('Revoked Salary Plan original is denied', true);
  await api('sara', `${teamPath}/messages/${salaryAnswer.body.id}/feedback`, { method: 'PATCH', json: { rating: 'helpful' } }, 404); check('Revoked answer feedback cannot expose the old response', true);
  const revokedReplay = await ask('sara', salaryConversation, salaryKey, salaryQuestion);
  check('Revoked idempotent replay does not return the cached private answer', revokedReplay.status === 201 && revokedReplay.body.available === false && !revokedReplay.body.answer);
  await api('hina', `${teamPath}/conversations/${salaryConversation}/messages`, {}, 404); check('Hina admin cannot read Sara private chat', true);

  stage = 'Same-team admin without a content grant';
  const memoBytes = Buffer.from('Synthetic private editor memo. This is a permission-test fixture, with no salary or personal records.');
  memo = await api('sara', teamPath + '/documents', { method: 'POST', form: form(memoBytes, 'Private memo.txt', 'Temporary private editor challenge ' + runId.slice(-6)) }, 201);
  const memoDownload = `${teamPath}/documents/${memo.id}/versions/${memo.versionId}/download`;
  await api('hina', memoDownload, {}, 404); check('Hina HR admin has no automatic read on Sara restricted memo', true);
  await api('hina', `${teamPath}/documents/${memo.id}/grants`, { method: 'POST', json: { membershipId: hinaMember } }, 201);
  check('Trusted HR admin can explicitly self-grant through the audited ACL action', (await api('hina', memoDownload, { bytes: true })).equals(memoBytes));
  await api('hina', `${teamPath}/documents/${memo.id}/grants/${hinaMember}`, { method: 'DELETE' });
  await api('hina', memoDownload, {}, 404); check('Revoking the explicit admin grant removes memo read again', true);
  await api('sara', `${teamPath}/documents/${memo.id}`, { method: 'DELETE' }); evidence.cleanup.temporaryMemoDeleteRequested = true;
  await api('sara', memoDownload, {}, 404); check('Deleting the temporary memo immediately denies its original', true);

  const questions = ['According to the TechCo HR Handbook, how many working days of annual leave are allowed per calendar year?', 'According to the TechCo HR Handbook, how many remote work days are allowed per week?'];
  const who = ['ali','sara'];
  stage = 'Two simultaneous questions with quota available';
  const normalUsage = await api('hina', teamPath + '/admin/usage');
  if (normalUsage.limit < normalUsage.used + 2) throw new Error('INSUFFICIENT_BASELINE_QUOTA');
  const normalIds = [await newConversation('ali'), await newConversation('sara')], normalKeys = [runId+'-normal-1', runId+'-normal-2'];
  const normal = await pair(who.map((person,i) => ask(person, normalIds[i], normalKeys[i], questions[i])), normalUsage.limit);
  const normalLedger = await ledger(normalKeys);
  check('Two different simultaneous questions both succeed when two slots exist', normal.responses.every(row => row.status === 201 && row.body.kind === 'grounded'));
  check('Two allowed questions save and charge exactly twice with no lingering holds', normalLedger.reservations === 2 && normalLedger.charged === 2 && normalLedger.answers === 2 && normalLedger.held === 0);
  check('Observed usage never exceeded the normal team limit', !normal.overLimit);
  evidence.concurrency.twoAllowed = { statuses: normal.responses.map(row => row.status), usedBefore: normalUsage.used, configuredLimit: normalUsage.limit, maximumObservedHeld: normal.maxHeld, sampleCount: normal.samples, ledger: normalLedger };

  stage = 'Last remaining quota slot: two simultaneous questions';
  const usage = await api('hina', teamPath + '/admin/usage');
  if (usage.held !== 0) throw new Error('UNRELATED_REQUEST_IN_FLIGHT');
  const lastLimit = usage.used + 1; await changeBudget(lastLimit);
  const raceIds = [await newConversation('ali'), await newConversation('sara')], raceKeys = [runId+'-last-1', runId+'-last-2'];
  try {
    const race = await pair(who.map((person,i) => ask(person, raceIds[i], raceKeys[i], questions[i])), lastLimit);
    const counts = await ledger(raceKeys);
    check('Last-slot race has one success and one HTTP 429 quota denial', JSON.stringify(race.responses.map(row => row.status).sort()) === JSON.stringify([201,429]));
    check('Last-slot race saves and charges exactly one answer', counts.reservations === 1 && counts.charged === 1 && counts.answers === 1 && counts.held === 0);
    check('Observed used plus held never exceeded the last-slot budget', !race.overLimit && race.maxHeld <= 1);
    evidence.concurrency.lastSlot = { outcomes: race.responses.map((row,i) => ({person:who[i],status:row.status})), usedBefore: usage.used, temporaryLimit: lastLimit, remainingSlotsAtStart: 1, originalLimitToRestore: originalLimit, maximumObservedHeld: race.maxHeld, sampleCount: race.samples, ledger: counts };
  } finally { await restoreBudget(); }

  stage = 'Concurrent duplicate submission with the same idempotency key';
  const duplicateId = await newConversation('ali'), duplicateKey = runId+'-duplicate';
  const duplicateUsage = await api('hina', teamPath + '/admin/usage');
  const duplicate = await pair([ask('ali', duplicateId, duplicateKey, questions[0]), ask('ali', duplicateId, duplicateKey, questions[0])], duplicateUsage.limit);
  const statuses = duplicate.responses.map(row => row.status).sort();
  check('Duplicate in-flight submissions return success plus conflict or the same completed result', JSON.stringify(statuses) === JSON.stringify([201,409]) || (statuses.every(status => status === 201) && duplicate.responses[0].body.id === duplicate.responses[1].body.id));
  const replay = await ask('ali', duplicateId, duplicateKey, questions[0]);
  const successful = duplicate.responses.find(row => row.status === 201);
  check('Completed duplicate replay returns the same saved message', replay.status === 201 && replay.body.id === successful.body.id);
  const duplicateLedger = await ledger([duplicateKey]);
  check('Concurrent duplicates use one reservation, one saved answer and one charge', duplicateLedger.reservations === 1 && duplicateLedger.charged === 1 && duplicateLedger.answers === 1 && duplicateLedger.held === 0);
  const changed = await ask('ali', duplicateId, duplicateKey, 'A different question using the previous request key.');
  check('Changed question with an old idempotency key is rejected', changed.status === 409);
  evidence.concurrency.duplicate = { statuses, replayStatus: replay.status, changedQuestionStatus: changed.status, ledger: duplicateLedger };
} catch (error) {
  failure = { stage, code: /^(HTTP_[0-9]+|ASSERTION_FAILED|AUTH_FAILED|ACCOUNT_FILE_INVALID|WORKER_NOT_READY|EXISTING_SALARY_VERSION_PRESERVED|EXTERNAL_BUDGET_CHANGE_PRESERVED|INSUFFICIENT_BASELINE_QUOTA|UNRELATED_REQUEST_IN_FLIGHT)$/.test(error.message) ? error.message : 'LIVE_CHALLENGE_FAILED' };
} finally {
  if (salaryGrant) { try { await api('hina', salaryPath + '/grants/' + saraMember, {method:'DELETE'}); } catch { evidence.cleanup.salaryGrantRemovalFailed = true; } }
  try { await restoreBudget(); evidence.cleanup.budgetRestored = !budgetTouched; } catch { evidence.cleanup.budgetRestored = false; }
  if (memo && !evidence.cleanup.temporaryMemoDeleteRequested) { try { await api('sara', `${teamPath}/documents/${memo.id}`, {method:'DELETE'}); evidence.cleanup.temporaryMemoDeleteRequested = true; } catch {} }
  let purged = 0;
  for (const conversation of conversations) { try { await api(conversation.person, `${teamPath}/conversations/${conversation.id}`, {method:'DELETE'}); purged++; } catch {} }
  evidence.cleanup.testConversationsCreated = conversations.length; evidence.cleanup.testConversationsPurged = purged;
  if (tokens.has('hina')) {
    try {
      const roles = (await api('hina',teamPath+'/members')).filter(row=>!row.removedAt).map(row=>({id:row.id,role:row.role})).sort((a,b)=>a.id.localeCompare(b.id));
      evidence.cleanup.originalRolesPreserved = JSON.stringify(roles) === JSON.stringify(originalRoles);
      const readers = await api('hina', salaryPath+'/readers');
      evidence.cleanup.salaryFinalHinaOnly = readers.length === 1 && readers[0].membershipId === hinaMember;
      const usage = await api('hina',teamPath+'/admin/usage');
      evidence.finalUsage = { limit:usage.limit, used:usage.used, held:usage.held };
    } catch {}
  }
  await sql.end().catch(()=>{});
  for (const client of clients.values()) { try { await client.auth.signOut({scope:'local'}); } catch {} }
  evidence.success = !failure && evidence.cleanup.budgetRestored && evidence.cleanup.originalRolesPreserved && evidence.cleanup.salaryFinalHinaOnly && purged === conversations.length;
  if (failure) evidence.failure = failure;
  writeFileSync('docs/live-challenges-run.json', JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({ success:evidence.success, checksPassed:evidence.checks.length, concurrency:evidence.concurrency, cleanup:evidence.cleanup, finalUsage:evidence.finalUsage, failure, credentialsOrFileBodiesPrinted:false }));
  if (!evidence.success) process.exitCode = 1;
}
