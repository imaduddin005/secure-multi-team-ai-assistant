import { z } from 'zod';

export function setting(name: string, fallback = ''): string {
  const value = process.env[name] || fallback;
  return /YOUR_|REPLACE_ME|CHOOSE_IN_/.test(value) ? '' : value;
}
export const uuid = z.string().uuid();
export const role = z.enum(['viewer', 'editor', 'admin']);
export const memberInput = z.object({ userId: uuid, role }).strict();
export const roleInput = z.object({ role }).strict();
export const maxUpload = 20 * 1024 * 1024;
export function config() {
  const aiBaseUrl = setting('AI_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, '');
  return {
    apiDatabaseUrl: setting('API_DATABASE_URL'), workerDatabaseUrl: setting('WORKER_DATABASE_URL'),
    supabaseUrl: setting('SUPABASE_URL'), publishableKey: setting('SUPABASE_PUBLISHABLE_KEY', setting('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')),
    storageKey: setting('SUPABASE_SERVER_STORAGE_KEY'), bucket: setting('SUPABASE_PRIVATE_BUCKET', 'team-documents'),
    issuer: setting('SUPABASE_JWT_ISSUER'), audience: setting('SUPABASE_JWT_AUDIENCE', 'authenticated'),
    webOrigin: setting('WEB_ORIGIN', 'http://localhost:3000'), port: Number(setting('API_PORT', '3001')),
    redisUrl: setting('REDIS_URL', 'redis://127.0.0.1:6379'),
    aiBaseUrl,
    embeddingBaseUrl: setting('EMBEDDING_BASE_URL', aiBaseUrl).replace(/\/+$/, ''),
    answerBaseUrl: setting('ANSWER_BASE_URL', aiBaseUrl).replace(/\/+$/, ''),
    embeddingKey: setting('EMBEDDING_API_KEY'), answerKey: setting('ANSWER_API_KEY'),
    embeddingModel: setting('EMBEDDING_MODEL'), answerModel: setting('ANSWER_MODEL'),
    dimensions: Number(setting('EMBEDDING_DIMENSIONS', '1536')), chunkerVersion: 'location-v1',
  };
}
export type Config = ReturnType<typeof config>;
