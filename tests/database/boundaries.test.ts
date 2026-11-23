import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { contexts, demo, localDatabaseUrl } from '../../tools/database/config';
import { bootstrapLocal, createClient, migrate, seed, withContext } from '../../tools/database/database';
import { checksum, createAnswer, createIntent, createVersion, grantSalary } from './fixtures';

let owner: Client;
let api: Client;
let worker: Client;
const ali = contexts['ali-hr']!;
const sara = contexts['sara-hr']!;
const hina = contexts['hina-hr']!;
const engineeringSara = contexts['sara-engineering']!;

async function ownerConnection(): Promise<Client> {
  const client = createClient(localDatabaseUrl('TEST_DATABASE_URL', 'assistant_test'));
  await client.connect(); await client.query('SET ROLE app_owner'); return client;
}

async function titles(context = ali): Promise<string[]> {
  return withContext(api, context, async client =>
    (await client.query<{ title: string }>('SELECT title FROM app.documents ORDER BY title')).rows.map(row => row.title));
}

beforeAll(async () => {
  await bootstrapLocal(true);
  owner = await ownerConnection();
  const identity = await owner.query<{ database: string; cluster: string }>(
    "SELECT current_database() AS database, current_setting('cluster_name') AS cluster");
  if (identity.rows[0]?.database !== 'assistant_test' || identity.rows[0]?.cluster !== 'secure-assistant-test') {
    throw new Error('Refusing reset: use the dedicated assistant_test cluster with its required cluster_name.');
  }
  // Intentionally destructive only inside the dedicated, positively identified test database.
  await owner.query('DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA IF EXISTS app_private CASCADE; DROP SCHEMA IF EXISTS app_meta CASCADE');
  await migrate(owner);
  api = createClient(localDatabaseUrl('TEST_API_DATABASE_URL', 'assistant_test'));
  worker = createClient(localDatabaseUrl('TEST_WORKER_DATABASE_URL', 'assistant_test'));
  await api.connect(); await worker.connect();
}, 60000);

beforeEach(async () => {
  const tables = await owner.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'app' ORDER BY tablename");
  const quoted = tables.rows.map(row => `app."${row.tablename.replaceAll('"', '""')}"`).join(', ');
  await owner.query(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
  await seed(owner);
});

afterAll(async () => {
  await Promise.allSettled([owner?.end(), api?.end(), worker?.end()]);
});

test('schema: all 21 business tables force RLS and real pgvector is installed', async () => {
  const result = await owner.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    "SELECT relrowsecurity, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relkind = 'r'");
  expect(result.rows).toHaveLength(21);
  expect(result.rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  expect((await owner.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'")).rowCount).toBe(1);
});

test('roles: actual runtime logins are non-owner/NOBYPASSRLS and cannot assume privileged roles', async () => {
  expect((await api.query('SELECT current_user')).rows[0].current_user).toBe('app_api');
  expect((await worker.query('SELECT current_user')).rows[0].current_user).toBe('app_worker');
  const roles = await owner.query("SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname IN ('app_api', 'app_worker')");
  expect(roles.rows).toHaveLength(2);
  expect(roles.rows.every(row => !row.rolsuper && !row.rolbypassrls && !row.rolcreatedb && !row.rolcreaterole)).toBe(true);
  await expect(api.query('SET ROLE app_owner')).rejects.toMatchObject({ code: '42501' });
  await expect(api.query('SET ROLE app_commands')).rejects.toMatchObject({ code: '42501' });
});

test('RLS: missing/malformed identity context fails closed and transaction context resets', async () => {
  expect((await api.query('SELECT * FROM app.documents')).rowCount).toBe(0);
  await withContext(api, ali, async client => {
    expect((await client.query('SELECT * FROM app.documents')).rowCount).toBe(1);
    await client.query("SELECT set_config('app.user_id', 'not-a-uuid', true)");
    expect((await client.query('SELECT * FROM app.documents')).rowCount).toBe(0);
  });
  expect((await api.query('SELECT * FROM app.documents')).rowCount).toBe(0);
});

test('RLS: TechCo read matrix hides restricted and cross-team titles even for admins', async () => {
  expect(await titles(ali)).toEqual(['Leave Policy']);
  expect(await titles(sara)).toEqual(['Leave Policy']);
  expect(await titles(engineeringSara)).toEqual(['API Guide']);
  expect(await titles(hina)).toEqual(['Leave Policy', 'Salary Plan']);
  expect(await titles(contexts['ahmed-engineering']!)).toEqual(['API Guide']);
  await owner.query(`UPDATE app.document_grants SET revoked_at = clock_timestamp(), revoked_by_membership_id = $1
    WHERE document_id = $2`, [demo.memberships.hina, demo.documents.salary]);
  expect(await titles(hina)).toEqual(['Leave Policy']);
  await withContext(api, hina, async client => {
    expect((await client.query('SELECT id FROM app.documents WHERE id = $1', [demo.documents.salary])).rowCount).toBe(0);
    expect((await client.query('SELECT id FROM app.documents WHERE id = $1', [randomUUID()])).rowCount).toBe(0);
  });
});

test('privileges: viewers/admins have no direct DML, storage locator, DDL, or audit append capability', async () => {
  await expect(withContext(api, ali, client => client.query("UPDATE app.documents SET title = 'tamper'")))
    .rejects.toMatchObject({ code: '42501' });
  await expect(api.query('SELECT object_key FROM app.storage_intents')).rejects.toMatchObject({ code: '42501' });
  await expect(api.query('CREATE TABLE app.forbidden(id integer)')).rejects.toMatchObject({ code: '42501' });
  await expect(api.query('TRUNCATE app.audit_logs')).rejects.toMatchObject({ code: '42501' });
  await expect(api.query("SELECT app_private.append_audit(NULL, 'fake', 'security', NULL)")).rejects.toMatchObject({ code: '42501' });
});

test('privileges: worker cannot read private messages; policy helper cannot read source text', async () => {
  await expect(worker.query('SELECT body_text FROM app.messages')).rejects.toMatchObject({ code: '42501' });
  await owner.query('SET ROLE app_policy_reader');
  try { await expect(owner.query('SELECT content_text FROM app.document_chunks')).rejects.toMatchObject({ code: '42501' }); }
  finally { await owner.query('SET ROLE app_owner'); }
});

test('migrations/seed: checksums make reruns no-ops and existing role/budget changes are preserved', async () => {
  expect(await migrate(owner)).toEqual([]);
  await owner.query("UPDATE app.memberships SET role = 'viewer' WHERE id = $1", [demo.memberships.saraHr]);
  await owner.query('UPDATE app.usage_budgets SET monthly_answer_limit = 17 WHERE team_id = $1', [demo.hr]);
  await seed(owner);
  expect((await owner.query('SELECT count(*)::integer AS n FROM app.memberships')).rows[0].n).toBe(5);
  expect((await owner.query('SELECT role FROM app.memberships WHERE id = $1', [demo.memberships.saraHr])).rows[0].role).toBe('viewer');
  expect((await owner.query('SELECT monthly_answer_limit FROM app.usage_budgets WHERE team_id = $1', [demo.hr])).rows[0].monthly_answer_limit).toBe(17);
  await owner.query("UPDATE app.memberships SET role='admin' WHERE id=$1", [demo.memberships.saraHr]);
  await owner.query('UPDATE app.memberships SET removed_at=clock_timestamp() WHERE id=$1', [demo.memberships.hina]);
  await seed(owner);
  expect((await owner.query('SELECT removed_at FROM app.memberships WHERE id=$1', [demo.memberships.hina])).rows[0].removed_at).not.toBeNull();
});

test('membership: duplicate active membership and last-admin demotion/removal are rejected', async () => {
  await expect(owner.query("INSERT INTO app.memberships(team_id,user_id,role) VALUES ($1,$2,'viewer')", [demo.hr, demo.users.sara])).rejects.toMatchObject({ code: '23505' });
  await expect(owner.query("UPDATE app.memberships SET role = 'viewer' WHERE id = $1", [demo.memberships.hina])).rejects.toMatchObject({ code: '23514' });
  await expect(owner.query('UPDATE app.memberships SET removed_at = clock_timestamp() WHERE id = $1', [demo.memberships.hina])).rejects.toMatchObject({ code: '23514' });
});

test('membership: removal revokes grants; rejoin uses new ID and cannot restore old membership', async () => {
  const grant = await grantSalary(owner);
  expect(await titles(sara)).toEqual(['Leave Policy', 'Salary Plan']);
  await owner.query('UPDATE app.memberships SET removed_at = clock_timestamp() WHERE id = $1', [sara.membershipId]);
  expect(await titles(sara)).toEqual([]);
  const newId = randomUUID();
  await owner.query("INSERT INTO app.memberships(id,team_id,user_id,role) VALUES ($1,$2,$3,'editor')", [newId, demo.hr, demo.users.sara]);
  expect(await titles({ ...sara, membershipId: newId })).toEqual(['Leave Policy']);
  expect((await owner.query('SELECT revoked_at, revoked_by_system FROM app.document_grants WHERE id = $1', [grant])).rows[0].revoked_by_system).toBe('membership-removal-trigger');
  await expect(owner.query('UPDATE app.memberships SET removed_at = NULL WHERE id = $1', [sara.membershipId])).rejects.toMatchObject({ code: '23514' });
});

test('membership concurrency: two connections cannot demote both final admins', async () => {
  await owner.query("UPDATE app.memberships SET role = 'admin' WHERE id = $1", [demo.memberships.saraHr]);
  const first = await ownerConnection(); const second = await ownerConnection();
  try {
    await first.query('BEGIN'); await second.query('BEGIN');
    await first.query('SELECT id FROM app.teams WHERE id = $1 FOR UPDATE', [demo.hr]);
    const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    const waiting = second.query("UPDATE app.memberships SET role = 'viewer' WHERE id = $1", [demo.memberships.saraHr])
      .then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
    const observed = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < observed) {
      const lock = await owner.query<{ blocked: boolean }>('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid]);
      if (lock.rows[0]!.blocked) { blocked = true; break; }
    }
    expect(blocked).toBe(true); // Actual database lock observation; no arbitrary sleep.
    await first.query("UPDATE app.memberships SET role = 'viewer' WHERE id = $1", [demo.memberships.hina]);
    await first.query('COMMIT');
    const resumed = await waiting;
    if (!resumed.ok) throw resumed.error;
    await expect(second.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
    await second.query('ROLLBACK');
    expect((await owner.query("SELECT count(*)::integer AS n FROM app.memberships WHERE team_id = $1 AND role = 'admin' AND removed_at IS NULL", [demo.hr])).rows[0].n).toBe(1);
  } finally {
    await Promise.allSettled([first.query('ROLLBACK'), second.query('ROLLBACK')]);
    await first.end(); await second.end();
  }
});

test('constraints: cross-team and removed-membership grants are rejected', async () => {
  await expect(grantSalary(owner, demo.memberships.saraEngineering)).rejects.toMatchObject({ code: '23503' });
  await owner.query('UPDATE app.memberships SET removed_at = clock_timestamp() WHERE id = $1', [sara.membershipId]);
  await expect(grantSalary(owner)).rejects.toMatchObject({ code: '23514' });
});

test('documents: default restricted visibility requires an initial uploader grant before commit', async () => {
  await expect(owner.query(`INSERT INTO app.documents(team_id,created_by_membership_id,title)
    VALUES ($1,$2,'Test-only incomplete document')`, [demo.hr, demo.memberships.saraHr])).rejects.toMatchObject({ code: '23514' });
  await owner.query('BEGIN');
  try {
    const row = (await owner.query(`INSERT INTO app.documents(team_id,created_by_membership_id,title)
      VALUES ($1,$2,'Test-only restricted') RETURNING id, visibility`, [demo.hr, demo.memberships.saraHr])).rows[0];
    expect(row.visibility).toBe('restricted');
    await owner.query(`INSERT INTO app.document_grants(team_id,document_id,grantee_membership_id,granted_by_membership_id)
      VALUES ($1,$2,$3,$3)`, [demo.hr, row.id, demo.memberships.saraHr]);
    await owner.query('COMMIT');
  } catch (error) { await owner.query('ROLLBACK'); throw error; }
});

test('constraints: same-team storage attachment and version/chunk uniqueness are enforced', async () => {
  const foreignIntent = await createIntent(owner, demo.engineering, demo.memberships.ahmed);
  await expect(owner.query(`INSERT INTO app.document_versions(document_id,team_id,version_number,created_by_membership_id,
    storage_intent_id,original_filename,mime_type,byte_size,content_sha256)
    VALUES($1,$2,1,$3,$4,'test.txt','text/plain',5,$5)`,
  [demo.documents.leave, demo.hr, demo.memberships.hina, foreignIntent, checksum])).rejects.toMatchObject({ code: '23503' });
  const version = await createVersion(owner, demo.documents.leave, demo.hr, demo.memberships.hina, 1, false);
  await expect(owner.query(`INSERT INTO app.document_chunks(team_id,document_id,version_id,embedding_profile_id,
    embedding_dimensions,chunk_ordinal,location_kind,line_start,line_end,content_text,content_sha256,embedding)
    VALUES($1,$2,$3,$4,3,0,'lines',1,3,'duplicate',$5,'[1,0,0]')`,
  [demo.hr, demo.documents.leave, version.versionId, version.profileId, checksum])).rejects.toMatchObject({ code: '23505' });
});

test('constraints: cross-team chunks and embedding dimension mismatch are rejected', async () => {
  const version = await createVersion(owner, demo.documents.leave, demo.hr, demo.memberships.hina, 1, false);
  const sql = `INSERT INTO app.document_chunks(team_id,document_id,version_id,embedding_profile_id,
    embedding_dimensions,chunk_ordinal,location_kind,line_start,line_end,content_text,content_sha256,embedding)
    VALUES($1,$2,$3,$4,3,1,'lines',1,3,'test-only',$5,$6)`;
  await expect(owner.query(sql, [demo.engineering, demo.documents.leave, version.versionId, version.profileId, checksum, '[1,0,0]'])).rejects.toMatchObject({ code: '23503' });
  await expect(owner.query(sql, [demo.hr, demo.documents.leave, version.versionId, version.profileId, checksum, '[1,0]'])).rejects.toMatchObject({ code: '23514' });
});

test('versions: ready content is immutable and current version cannot regress', async () => {
  const first = await createVersion(owner);
  const second = await createVersion(owner, demo.documents.leave, demo.hr, demo.memberships.hina, 2);
  await expect(owner.query("UPDATE app.document_chunks SET content_text = 'changed' WHERE id = $1", [first.chunkId])).rejects.toMatchObject({ code: '23514' });
  await expect(owner.query("UPDATE app.document_versions SET original_filename = 'changed.txt' WHERE id = $1", [first.versionId])).rejects.toMatchObject({ code: '23514' });
  await expect(owner.query('UPDATE app.documents SET current_version_id = $1 WHERE id = $2', [first.versionId, demo.documents.leave])).rejects.toMatchObject({ code: '23514' });
  expect((await owner.query('SELECT current_version_id FROM app.documents WHERE id = $1', [demo.documents.leave])).rows[0].current_version_id).toBe(second.versionId);
});

test('versions: failed replacement preserves current-ready retrieval; historical chunks stay authorized', async () => {
  const first = await createVersion(owner);
  const failed = await createVersion(owner, demo.documents.leave, demo.hr, demo.memberships.hina, 2, false);
  await owner.query("UPDATE app.document_versions SET state = 'failed', failure_code = 'TEST_ONLY_FAILURE' WHERE id = $1", [failed.versionId]);
  await withContext(api, ali, async client => {
    expect((await client.query('SELECT id FROM app.readable_current_chunks')).rows).toEqual([{ id: first.chunkId }]);
  });
});

test('chat foundations: another membership and even team admin cannot read a private conversation', async () => {
  const answer = await createAnswer(owner, sara, [await createVersion(owner)]);
  await withContext(api, sara, async client => expect((await client.query('SELECT id FROM app.messages WHERE id = $1', [answer.messageId])).rowCount).toBe(1));
  for (const context of [ali, hina, engineeringSara]) {
    await withContext(api, context, async client => {
      expect((await client.query('SELECT id FROM app.conversations WHERE id = $1', [answer.conversationId])).rowCount).toBe(0);
      expect((await client.query('SELECT id FROM app.messages WHERE id = $1', [answer.messageId])).rowCount).toBe(0);
      expect((await client.query('SELECT id FROM app.message_sources WHERE message_id = $1', [answer.messageId])).rowCount).toBe(0);
    });
  }
});

test('provenance: an uncited revoked source hides the whole answer, citations and feedback', async () => {
  const leave = await createVersion(owner);
  const salary = await createVersion(owner, demo.documents.salary);
  const grant = await grantSalary(owner);
  const answer = await createAnswer(owner, sara, [leave, salary]);
  await owner.query(`INSERT INTO app.feedback(team_id,owner_membership_id,user_id,message_id,rating)
    VALUES($1,$2,$3,$4,'helpful')`, [demo.hr, sara.membershipId, sara.userId, answer.messageId]);
  await withContext(api, sara, async client => expect((await client.query('SELECT * FROM app.message_sources WHERE message_id=$1', [answer.messageId])).rowCount).toBe(2));
  await owner.query('UPDATE app.document_grants SET revoked_at=clock_timestamp(),revoked_by_membership_id=$1 WHERE id=$2', [demo.memberships.hina, grant]);
  await withContext(api, sara, async client => {
    expect((await client.query('SELECT * FROM app.messages WHERE id=$1', [answer.messageId])).rowCount).toBe(0);
    expect((await client.query('SELECT * FROM app.message_sources WHERE message_id=$1', [answer.messageId])).rowCount).toBe(0);
    expect((await client.query('SELECT * FROM app.feedback WHERE message_id=$1', [answer.messageId])).rowCount).toBe(0);
  });
});

test('provenance: missing sources, uncited grounded answers and cross-team sources cannot finalize', async () => {
  const leave = await createVersion(owner);
  await expect(createAnswer(owner, sara, [leave], 2)).rejects.toMatchObject({ code: '23514' });
  await expect(createAnswer(owner, sara, [])).rejects.toMatchObject({ code: '23514' });
  await expect(createAnswer(owner, sara, [leave], 1, false)).rejects.toMatchObject({ code: '23514' });
  const foreign = await createVersion(owner, demo.documents.api, demo.engineering, demo.memberships.ahmed);
  await expect(createAnswer(owner, sara, [foreign])).rejects.toMatchObject({ code: '23503' });
});

test('deletion: invalidate answer before provenance/chunk purge and reject stale resurrection', async () => {
  const version = await createVersion(owner);
  const answer = await createAnswer(owner, sara, [version]);
  await expect(owner.query('DELETE FROM app.message_sources WHERE message_id=$1', [answer.messageId])).rejects.toMatchObject({ code: '23514' });
  await expect(owner.query('DELETE FROM app.document_chunks WHERE id=$1', [version.chunkId])).rejects.toMatchObject({ code: '23514' });
  await owner.query('UPDATE app.documents SET deleted_at=clock_timestamp(),current_version_id=NULL WHERE id=$1', [version.documentId]);
  expect((await owner.query('SELECT permanently_unavailable_at FROM app.messages WHERE id=$1', [answer.messageId])).rows[0].permanently_unavailable_at).not.toBeNull();
  await owner.query('UPDATE app.message_sources SET chunk_id=NULL WHERE message_id=$1', [answer.messageId]);
  await owner.query('DELETE FROM app.document_chunks WHERE id=$1', [version.chunkId]);
  await owner.query("UPDATE app.document_versions SET state='purged' WHERE id=$1", [version.versionId]);
  await expect(owner.query('UPDATE app.documents SET deleted_at=NULL WHERE id=$1', [version.documentId])).rejects.toMatchObject({ code: '23514' });
  await expect(owner.query("UPDATE app.document_versions SET state='ready' WHERE id=$1", [version.versionId])).rejects.toMatchObject({ code: '23514' });
  await withContext(api, sara, async client => expect((await client.query('SELECT id FROM app.messages WHERE id=$1', [answer.messageId])).rowCount).toBe(0));
});

test('constraints: source ownership and per-user feedback uniqueness are enforced', async () => {
  const answer = await createAnswer(owner, sara, [await createVersion(owner)]);
  await expect(owner.query(`INSERT INTO app.feedback(team_id,owner_membership_id,user_id,message_id,rating)
    VALUES($1,$2,$3,$4,'helpful')`, [demo.hr, ali.membershipId, ali.userId, answer.messageId])).rejects.toMatchObject({ code: '23503' });
  const values = [demo.hr, sara.membershipId, sara.userId, answer.messageId];
  const sql = "INSERT INTO app.feedback(team_id,owner_membership_id,user_id,message_id,rating) VALUES($1,$2,$3,$4,'helpful')";
  await owner.query(sql, values);
  await expect(owner.query(sql, values)).rejects.toMatchObject({ code: '23505' });
});

test('quota foundations: UTC boundaries, scoped idempotency, nonnegative counters and one hold', async () => {
  await expect(owner.query(`INSERT INTO app.usage_periods(team_id,period_start,period_end)
    VALUES($1,'2026-11-01T00:00:00+05:00','2026-12-01T00:00:00+05:00')`, [demo.hr])).rejects.toMatchObject({ code: '23514' });
  const answer = await createAnswer(owner, sara, [await createVersion(owner)]);
  await expect(owner.query('UPDATE app.usage_periods SET held_count=-1 WHERE team_id=$1', [demo.hr])).rejects.toMatchObject({ code: '23514' });
  await expect(owner.query(`INSERT INTO app.usage_reservations(team_id,owner_membership_id,conversation_id,idempotency_key,request_fingerprint)
    SELECT team_id,owner_membership_id,conversation_id,idempotency_key,request_fingerprint FROM app.usage_reservations WHERE id=$1`, [answer.requestId])).rejects.toMatchObject({ code: '23505' });
  const newRequest = randomUUID();
  await owner.query(`INSERT INTO app.usage_reservations(id,team_id,owner_membership_id,conversation_id,idempotency_key,request_fingerprint)
    VALUES($1,$2,$3,$4,$6,$5)`, [newRequest,demo.hr,sara.membershipId,answer.conversationId,checksum,newRequest]);
  const period = (await owner.query('SELECT id FROM app.usage_periods WHERE team_id=$1', [demo.hr])).rows[0].id;
  const hold = `INSERT INTO app.usage_attempts(team_id,reservation_id,attempt_number,period_id,lease_expires_at)
    VALUES($1,$2,$3,$4,clock_timestamp()+interval '5 minutes')`;
  await owner.query(hold, [demo.hr,newRequest,1,period]);
  await expect(owner.query(hold, [demo.hr,newRequest,2,period])).rejects.toMatchObject({ code: '23505' });
  await expect(owner.query('UPDATE app.usage_reservations SET current_attempt_number=7 WHERE id=$1', [newRequest])).rejects.toMatchObject({ code: '23503' });
});

test('jobs/outbox: target consistency, duplicate logical jobs, and transaction rollback are real', async () => {
  const version = await createVersion(owner);
  const job = randomUUID();
  await owner.query("INSERT INTO app.processing_jobs(id,team_id,kind,document_id,version_id) VALUES($1,$2,'process_version',$3,$4)", [job,demo.hr,version.documentId,version.versionId]);
  await expect(owner.query("INSERT INTO app.processing_jobs(team_id,kind,document_id,version_id) VALUES($1,'process_version',$2,$3)", [demo.hr,version.documentId,version.versionId])).rejects.toMatchObject({ code: '23505' });
  await owner.query('BEGIN');
  await owner.query('INSERT INTO app.outbox_events(team_id,job_id,dedupe_key) VALUES($1,$2,$3)', [demo.hr,job,job]);
  await owner.query('ROLLBACK');
  expect((await owner.query('SELECT * FROM app.outbox_events')).rowCount).toBe(0);
});

test('audit: mutations append safe actor/correlation records atomically without titles or content', async () => {
  await withContext(owner, hina, async client => {
    await client.query("UPDATE app.memberships SET role='viewer' WHERE id=$1", [sara.membershipId]);
  });
  const row = (await owner.query("SELECT * FROM app.audit_logs WHERE action='membership.role_changed' ORDER BY occurred_at DESC LIMIT 1")).rows[0];
  expect(row.actor_user_id).toBe(hina.userId); expect(row.actor_membership_id).toBe(hina.membershipId);
  expect(row.request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(row.details).toEqual({ role_before: 'editor', role_after: 'viewer' });
  const before = (await owner.query('SELECT count(*) AS n FROM app.audit_logs')).rows[0].n;
  await owner.query('BEGIN');
  await owner.query("UPDATE app.memberships SET role='editor' WHERE id=$1", [sara.membershipId]);
  await owner.query('ROLLBACK');
  expect((await owner.query('SELECT count(*) AS n FROM app.audit_logs')).rows[0].n).toBe(before);
  expect(JSON.stringify((await owner.query('SELECT details FROM app.audit_logs')).rows)).not.toMatch(/Salary Plan|Leave Policy|Test-only source/);
});

test('audit: hidden-document events are filtered before admin access and ordinary tampering is denied', async () => {
  await owner.query('UPDATE app.document_grants SET revoked_at=clock_timestamp(),revoked_by_membership_id=$1 WHERE document_id=$2', [hina.membershipId,demo.documents.salary]);
  await withContext(api, hina, async client => {
    expect((await client.query('SELECT * FROM app.audit_logs WHERE target_id=$1', [demo.documents.salary])).rowCount).toBe(0);
  });
  await expect(api.query("DELETE FROM app.audit_logs")).rejects.toMatchObject({ code: '42501' });
  await expect(owner.query(`INSERT INTO app.audit_logs(actor_kind,system_actor,action,target_type,request_id,details)
    VALUES('system','test-only','test','security',$1,'{"document_title":"forbidden"}')`, [randomUUID()])).rejects.toMatchObject({ code: '23514' });
});
