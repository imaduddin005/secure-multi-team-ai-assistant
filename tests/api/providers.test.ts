/** Real loopback HTTP transport with test-only provider responses; no cloud calls. */
import { createServer, Server } from 'node:http';
import { createHash } from 'node:crypto';
import { BadGatewayException } from '@nestjs/common';
import { config, Config } from '../../apps/api/src/config';
import { CompatibleAI, profileKey } from '../../apps/api/src/providers';
import type { Source } from '../../apps/api/src/types';

let embeddings: Server;
let answers: Server;
let embeddingUrl: string;
let answerUrl: string;
let embeddingStatus = 200;
let embeddingData: unknown;
let answerData: unknown;
const captured: { service: string; path: string; authorization?: string; body: any }[] = [];
const envNames = ['AI_BASE_URL', 'EMBEDDING_BASE_URL', 'ANSWER_BASE_URL'] as const;
let savedEnv: Record<string, string | undefined>;

async function server(service: string): Promise<{ server: Server; url: string }> {
  const instance = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      captured.push({ service, path: request.url || '', authorization: request.headers.authorization, body });
      response.setHeader('Content-Type', 'application/json');
      if (service === 'embedding' && request.url === '/v1/embeddings') {
        response.statusCode = embeddingStatus;
        response.end(JSON.stringify({ data: embeddingData }));
      } else if (service === 'answer' && request.url === '/v1/chat/completions') {
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answerData) } }] }));
      } else {
        response.statusCode = 404;
        response.end('{}');
      }
    } catch {
      response.statusCode = 500;
      response.end('{}');
    }
  });
  await new Promise<void>(resolve => instance.listen(0, '127.0.0.1', resolve));
  return { server: instance, url: `http://127.0.0.1:${(instance.address() as { port: number }).port}/v1` };
}

function testConfig(): Config {
  return { ...config(), aiBaseUrl: 'https://test-only-unused.invalid/v1',
    embeddingBaseUrl: embeddingUrl, answerBaseUrl: answerUrl,
    embeddingKey: 'test-only-embedding-key', answerKey: 'test-only-answer-key',
    embeddingModel: 'test-only-embedding', answerModel: 'test-only-answer', dimensions: 3 };
}

beforeAll(async () => {
  const embedding = await server('embedding');
  embeddings = embedding.server; embeddingUrl = embedding.url;
  const answer = await server('answer');
  answers = answer.server; answerUrl = answer.url;
});
beforeEach(() => {
  savedEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  captured.length = 0; embeddingStatus = 200;
  embeddingData = [{ index: 1, embedding: [0, 1, 0] }, { index: 0, embedding: [1, 0, 0] }];
  answerData = { answer: 'Test-only leave guidance.', citations: ['S1'] };
});
afterEach(() => {
  for (const name of envNames) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});
afterAll(async () => {
  for (const instance of [embeddings, answers]) {
    if (!instance) continue;
    instance.closeAllConnections();
    await new Promise<void>((resolve, reject) => instance.close(error => error ? reject(error) : resolve()));
  }
});

test('Module 4/6: separate provider endpoints fall back to the legacy shared endpoint', () => {
  process.env.AI_BASE_URL = 'https://shared.test-only.invalid/v1/';
  delete process.env.EMBEDDING_BASE_URL;
  process.env.ANSWER_BASE_URL = '';
  const shared = config();
  expect(shared.embeddingBaseUrl).toBe('https://shared.test-only.invalid/v1');
  expect(shared.answerBaseUrl).toBe(shared.aiBaseUrl);
  const legacyKey = createHash('sha256').update(JSON.stringify([shared.aiBaseUrl, shared.embeddingModel, shared.dimensions, shared.chunkerVersion])).digest('hex');
  expect(profileKey(shared)).toBe(legacyKey);
  process.env.EMBEDDING_BASE_URL = 'https://embedding.test-only.invalid/v1///';
  process.env.ANSWER_BASE_URL = 'https://answer.test-only.invalid/v1/';
  expect(config().embeddingBaseUrl).toBe('https://embedding.test-only.invalid/v1');
  expect(config().answerBaseUrl).toBe('https://answer.test-only.invalid/v1');
});

test('Module 4/6: mixed-provider HTTP requests keep keys, models and payloads on their own service', async () => {
  const cfg = testConfig();
  const ai = new CompatibleAI(cfg);
  expect(await ai.embed(['Test-only first chunk', 'Test-only second chunk'])).toEqual([[1, 0, 0], [0, 1, 0]]);
  const source: Source = { chunkId: 'test-only-chunk', documentId: 'test-only-document', versionId: 'test-only-version',
    title: 'Test-only Leave Policy', text: 'Submit a leave request to HR.', label: 'S1',
    locationKind: 'lines', pageStart: null, pageEnd: null, lineStart: 1, lineEnd: 1 };
  expect(await ai.answer('How do I request leave?', [source])).toEqual({ answer: 'Test-only leave guidance.', citations: ['S1'] });
  expect(captured).toHaveLength(2);
  expect(captured[0]).toMatchObject({ service: 'embedding', path: '/v1/embeddings', authorization: `Bearer ${cfg.embeddingKey}`,
    body: { model: cfg.embeddingModel, dimensions: 3, input: ['Test-only first chunk', 'Test-only second chunk'] } });
  expect(captured[1]).toMatchObject({ service: 'answer', path: '/v1/chat/completions', authorization: `Bearer ${cfg.answerKey}`,
    body: { model: cfg.answerModel, response_format: { type: 'json_object' } } });
  expect(JSON.stringify(captured[0])).not.toContain(cfg.answerKey);
  expect(JSON.stringify(captured[1])).not.toContain(cfg.embeddingKey);
  expect(JSON.parse(captured[1]!.body.messages[1].content).evidence).toEqual([{ label: 'S1', title: source.title, text: source.text }]);
});

test('Module 4/6: embedding profiles change with embedding identity and stay stable when the answer provider changes', () => {
  const cfg = testConfig(); const key = profileKey(cfg);
  expect(profileKey({ ...cfg, answerBaseUrl: 'https://other-answer.test-only.invalid', answerModel: 'other-test-only-model' })).toBe(key);
  expect(profileKey({ ...cfg, embeddingBaseUrl: 'https://other-embedding.test-only.invalid' })).not.toBe(key);
  expect(profileKey({ ...cfg, embeddingModel: 'other-test-only-model' })).not.toBe(key);
  expect(profileKey({ ...cfg, dimensions: 2 })).not.toBe(key);
  expect(profileKey({ ...cfg, chunkerVersion: 'other-test-only-chunker' })).not.toBe(key);
});

test('Module 6: provider refusal with omitted citations becomes an uncited result', async () => {
  answerData = { answer: 'Test-only evidence does not contain the requested fact.' };
  const result = await new CompatibleAI(testConfig()).answer('Test-only unavailable fact?', []);
  expect(result.citations).toEqual([]);
});

test('Module 6: malformed provider citation labels are a gateway error, not a client validation error', async () => {
  answerData = { answer: 'Test-only answer.', citations: ['INVALID_LABEL'] };
  await expect(new CompatibleAI(testConfig()).answer('Test-only question?', [])).rejects.toBeInstanceOf(BadGatewayException);
});

test('Module 4: index-free compatible embedding responses preserve input order', async () => {
  embeddingData = [{ embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }];
  expect(await new CompatibleAI(testConfig()).embed(['Test-only first chunk', 'Test-only second chunk'])).toEqual([[1, 0, 0], [0, 1, 0]]);
  expect(captured).toHaveLength(1);
});

test('Module 4: an omitted zero index is recovered without depending on response row order', async () => {
  embeddingData = [{ index: 1, embedding: [0, 1, 0] }, { embedding: [1, 0, 0] }];
  expect(await new CompatibleAI(testConfig()).embed(['Test-only first chunk', 'Test-only second chunk'])).toEqual([[1, 0, 0], [0, 1, 0]]);
});

test.each(['provider failure', 'wrong dimensions', 'duplicate indexes', 'missing index conflicts with explicit zero', 'multiple missing indexes', 'zero vectors'])('Module 4: mixed-provider embeddings reject %s', async failure => {
  if (failure === 'provider failure') embeddingStatus = 503;
  if (failure === 'wrong dimensions') embeddingData = [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [0, 1] }];
  if (failure === 'duplicate indexes') embeddingData = [{ index: 0, embedding: [1, 0, 0] }, { index: 0, embedding: [0, 1, 0] }];
  if (failure === 'missing index conflicts with explicit zero') embeddingData = [{ index: 0, embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }];
  if (failure === 'multiple missing indexes') embeddingData = [{ embedding: [1, 0, 0] }, { embedding: [0, 1, 0] }, { index: 2, embedding: [0, 0, 1] }];
  if (failure === 'zero vectors') embeddingData = [{ index: 0, embedding: [0, 0, 0] }, { index: 1, embedding: [0, 1, 0] }];
  const texts = failure === 'multiple missing indexes' ? ['Test-only first chunk', 'Test-only second chunk', 'Test-only third chunk'] : ['Test-only first chunk', 'Test-only second chunk'];
  await expect(new CompatibleAI(testConfig()).embed(texts)).rejects.toThrow();
  expect(captured).toHaveLength(1);
  expect(captured[0]!.service).toBe('embedding');
});
