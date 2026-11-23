import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { ServiceUnavailableException } from '@nestjs/common';

export class Database {
  readonly pool: Pool;
  constructor(url: string) {
    if (!url) throw new Error('API_DATABASE_URL is required');
    this.pool = new Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 10000, options: '-c statement_timeout=20000 -c lock_timeout=5000', application_name: 'secure-assistant-api' });
    this.pool.on('error', () => { /* No queries, secrets, or document text in logs. */ });
  }
  async transaction<T>(userId: string, teamId: string | undefined, work: (client: PoolClient) => Promise<T>, requestId: string = randomUUID()): Promise<T> {
    const client = await this.pool.connect().catch(() => { throw new ServiceUnavailableException('Database unavailable'); });
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.user_id',$1,true),set_config('app.team_id',$2,true),
        set_config('app.membership_id','',true),set_config('app.request_id',$3,true)`, [userId,teamId || '',requestId]);
      const result = await work(client);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async identity(subject: string, label: string): Promise<string> {
    const result = await this.pool.query<{ id: string }>('SELECT app_private.resolve_identity($1,$2) AS id', [subject,label]);
    return result.rows[0]!.id;
  }
  async command(userId: string, teamId: string | undefined, domain: string, operation: string, payload: unknown = {}, requestId?: string): Promise<any> {
    const functions: Record<string,string> = { membership:'membership_command',document:'document_command',quota:'quota_command',chat:'chat_command',admin:'admin_command' };
    const fn = functions[domain]; if (!fn) throw new Error('Invalid internal command domain');
    return this.transaction(userId,teamId,async client =>
      (await client.query(`SELECT app_private.${fn}($1,$2::jsonb) AS result`,[operation,JSON.stringify(payload)])).rows[0].result,requestId);
  }
  async close(): Promise<void> { await this.pool.end(); }
}
