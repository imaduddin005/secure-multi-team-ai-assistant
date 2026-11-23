import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const root = process.cwd();

export function required(name: string): string {
  const value = process.env[name];
  if (!value || /REPLACE_ME|YOUR_|CHOOSE_IN_/.test(value)) {
    throw new Error(`Configure ${name} in the root .env; do not paste it into chat.`);
  }
  return value;
}

export function localDatabaseUrl(name: string, expectedDatabase: string): string {
  const value = required(name);
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`Invalid ${name}; its value was not logged.`); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    || parsed.pathname !== `/${expectedDatabase}`) {
    throw new Error(`${name} must select the dedicated local ${expectedDatabase} database.`);
  }
  return value;
}

export function initializeLocalEnvironment(): boolean {
  const destination = resolve(root, '.env');
  if (existsSync(destination)) return false;
  const generated: Record<string, string> = {};
  for (const name of ['LOCAL_POSTGRES_PASSWORD', 'LOCAL_MIGRATOR_PASSWORD', 'LOCAL_API_PASSWORD',
    'LOCAL_WORKER_PASSWORD', 'LOCAL_TEST_POSTGRES_PASSWORD', 'LOCAL_TEST_MIGRATOR_PASSWORD',
    'LOCAL_TEST_API_PASSWORD', 'LOCAL_TEST_WORKER_PASSWORD']) {
    generated[name] = randomBytes(32).toString('base64url');
  }
  const url = (role: string, secret: string, port: number, database: string): string =>
    `postgresql://${role}:${generated[secret]}@127.0.0.1:${port}/${database}`;
  Object.assign(generated, {
    LOCAL_ADMIN_DATABASE_URL: url('postgres', 'LOCAL_POSTGRES_PASSWORD', 55432, 'assistant'),
    MIGRATION_DATABASE_URL: url('app_migrator', 'LOCAL_MIGRATOR_PASSWORD', 55432, 'assistant'),
    API_DATABASE_URL: url('app_api', 'LOCAL_API_PASSWORD', 55432, 'assistant'),
    WORKER_DATABASE_URL: url('app_worker', 'LOCAL_WORKER_PASSWORD', 55432, 'assistant'),
    TEST_ADMIN_DATABASE_URL: url('postgres', 'LOCAL_TEST_POSTGRES_PASSWORD', 55433, 'assistant_test'),
    TEST_DATABASE_URL: url('app_migrator', 'LOCAL_TEST_MIGRATOR_PASSWORD', 55433, 'assistant_test'),
    TEST_API_DATABASE_URL: url('app_api', 'LOCAL_TEST_API_PASSWORD', 55433, 'assistant_test'),
    TEST_WORKER_DATABASE_URL: url('app_worker', 'LOCAL_TEST_WORKER_PASSWORD', 55433, 'assistant_test'),
  });
  let content = readFileSync(resolve(root, '.env.example'), 'utf8');
  for (const [name, value] of Object.entries(generated)) {
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    content = pattern.test(content) ? content.replace(pattern, `${name}=${value}`) : `${content}\n${name}=${value}\n`;
  }
  // Exclusive creation also protects a file created concurrently by the learner.
  writeFileSync(destination, content, { flag: 'wx', mode: 0o600 });
  return true;
}

export const demo = {
  organization: '10000000-0000-4000-8000-000000000001',
  hr: '30000000-0000-4000-8000-000000000001',
  engineering: '30000000-0000-4000-8000-000000000002',
  users: {
    ali: '20000000-0000-4000-8000-000000000001',
    sara: '20000000-0000-4000-8000-000000000002',
    hina: '20000000-0000-4000-8000-000000000003',
    ahmed: '20000000-0000-4000-8000-000000000004',
  },
  memberships: {
    ali: '40000000-0000-4000-8000-000000000001',
    saraHr: '40000000-0000-4000-8000-000000000002',
    saraEngineering: '40000000-0000-4000-8000-000000000003',
    hina: '40000000-0000-4000-8000-000000000004',
    ahmed: '40000000-0000-4000-8000-000000000005',
  },
  documents: {
    leave: '50000000-0000-4000-8000-000000000001',
    salary: '50000000-0000-4000-8000-000000000002',
    api: '50000000-0000-4000-8000-000000000003',
  },
} as const;

export interface IdentityContext { userId: string; teamId: string; membershipId: string }
export const contexts: Record<string, IdentityContext> = {
  'ali-hr': { userId: demo.users.ali, teamId: demo.hr, membershipId: demo.memberships.ali },
  'sara-hr': { userId: demo.users.sara, teamId: demo.hr, membershipId: demo.memberships.saraHr },
  'sara-engineering': { userId: demo.users.sara, teamId: demo.engineering, membershipId: demo.memberships.saraEngineering },
  'hina-hr': { userId: demo.users.hina, teamId: demo.hr, membershipId: demo.memberships.hina },
  'ahmed-engineering': { userId: demo.users.ahmed, teamId: demo.engineering, membershipId: demo.memberships.ahmed },
};
