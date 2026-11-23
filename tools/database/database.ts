import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { type IdentityContext, localDatabaseUrl, required, root } from './config';

export function createClient(connectionString: string): Client {
  return new Client({ connectionString, connectionTimeoutMillis: 8000,
    application_name: 'secure-assistant-module-1',
    options: '-c statement_timeout=20000 -c lock_timeout=5000' });
}

export async function asOwner<T>(connectionString: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = createClient(connectionString);
  await client.connect();
  try { await client.query('SET ROLE app_owner'); return await work(client); }
  finally { await client.end(); }
}

export async function withContext<T>(client: Client, context: IdentityContext,
  work: (client: Client) => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.user_id', $1, true), set_config('app.team_id', $2, true),
      set_config('app.membership_id', $3, true), set_config('app.request_id', $4, true)`,
    [context.userId, context.teamId, context.membershipId, randomUUID()]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

export async function bootstrapLocal(test: boolean): Promise<void> {
  const prefix = test ? 'LOCAL_TEST_' : 'LOCAL_';
  const adminUrl = localDatabaseUrl(test ? 'TEST_ADMIN_DATABASE_URL' : 'LOCAL_ADMIN_DATABASE_URL',
    test ? 'assistant_test' : 'assistant');
  const client = createClient(adminUrl);
  await client.connect();
  try {
    const expectedCluster = test ? 'secure-assistant-test' : 'secure-assistant-demo';
    const identity = await client.query<{ cluster: string }>("SELECT current_setting('cluster_name') AS cluster");
    if (identity.rows[0]?.cluster !== expectedCluster) {
      throw new Error(`Refusing bootstrap: expected the dedicated ${expectedCluster} cluster.`);
    }
    await client.query('BEGIN');
    await client.query(readFileSync(resolve(root, 'database/bootstrap.sql'), 'utf8'));
    for (const [role, suffix] of [['app_migrator', 'MIGRATOR_PASSWORD'], ['app_api', 'API_PASSWORD'],
      ['app_worker', 'WORKER_PASSWORD']] as const) {
      const password = required(prefix + suffix);
      // PostgreSQL's own quoting handles DDL literals. Neither SQL nor secrets are logged.
      const result = await client.query<{ ddl: string }>(
        "SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS ddl", [role, password]);
      await client.query(result.rows[0]!.ddl);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
}

export async function migrate(client: Client): Promise<string[]> {
  await client.query("SELECT pg_advisory_lock(hashtext('secure-assistant:migrations'))");
  const applied: string[] = [];
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS app_meta AUTHORIZATION app_owner;
      REVOKE ALL ON SCHEMA app_meta FROM PUBLIC, app_api, app_worker;
      CREATE TABLE IF NOT EXISTS app_meta.schema_migrations (
        version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      ALTER TABLE app_meta.schema_migrations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE app_meta.schema_migrations FORCE ROW LEVEL SECURITY;`);
    const policy = await client.query("SELECT 1 FROM pg_policies WHERE schemaname = 'app_meta' AND tablename = 'schema_migrations'");
    if (!policy.rowCount) await client.query('CREATE POLICY migration_owner ON app_meta.schema_migrations TO app_owner USING (true) WITH CHECK (true)');
    const directory = resolve(root, 'database/migrations');
    for (const version of readdirSync(directory).filter(name => /^\d{3}_[a-z_]+\.sql$/.test(name)).sort()) {
      const sql = readFileSync(resolve(directory, version), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query<{ checksum: string }>('SELECT checksum FROM app_meta.schema_migrations WHERE version = $1', [version]);
      if (existing.rowCount) {
        if (existing.rows[0]!.checksum !== checksum) throw new Error(`Applied migration changed: ${version}; create a new migration instead.`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO app_meta.schema_migrations(version, checksum) VALUES ($1, $2)', [version, checksum]);
        await client.query('COMMIT');
        applied.push(version);
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    return applied;
  } finally { await client.query("SELECT pg_advisory_unlock(hashtext('secure-assistant:migrations'))"); }
}

export async function seed(client: Client): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.request_id', $1, true)", [randomUUID()]);
    await client.query(readFileSync(resolve(root, 'database/seeds/techco.sql'), 'utf8'));
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
