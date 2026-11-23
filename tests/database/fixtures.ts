/** Test-only relational fixtures. No real file, embedding provider, or Auth token. */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { demo, type IdentityContext } from '../../tools/database/config';

export const checksum = 'a'.repeat(64);
const profile = '70000000-0000-4000-8000-000000000001';
export interface VersionFixture {
  documentId: string; teamId: string; versionId: string; chunkId: string;
  intentId: string; profileId: string;
}

export async function createIntent(client: Client, teamId: string, membershipId: string): Promise<string> {
  const id = randomUUID();
  await client.query(`INSERT INTO app.storage_intents(id, team_id, uploader_membership_id, bucket, object_key, state)
    VALUES ($1, $2, $3, 'test-only-no-objects', $4, 'uploaded')`, [id, teamId, membershipId, `test-only/${id}`]);
  return id;
}

export async function createVersion(client: Client, documentId: string = demo.documents.leave,
  teamId: string = demo.hr, membershipId: string = demo.memberships.hina, number = 1, ready = true): Promise<VersionFixture> {
  await client.query(`INSERT INTO app.embedding_profiles(id, profile_key, provider_id, model_id, dimensions, chunker_version)
    VALUES ($1, 'test-only-three-dimensional', 'test-only', 'deterministic-fixture', 3, 'test-only-v1')
    ON CONFLICT DO NOTHING`, [profile]);
  const intentId = await createIntent(client, teamId, membershipId);
  const versionId = randomUUID();
  const chunkId = randomUUID();
  await client.query(`INSERT INTO app.document_versions(id, document_id, team_id, version_number,
    created_by_membership_id, storage_intent_id, original_filename, mime_type, byte_size, content_sha256,
    state, embedding_profile_id, embedding_dimensions)
    VALUES ($1, $2, $3, $4, $5, $6, 'test-only.txt', 'text/plain', 50, $7, 'processing', $8, 3)`,
  [versionId, documentId, teamId, number, membershipId, intentId, checksum, profile]);
  await client.query('UPDATE app.documents SET next_version_number = greatest(next_version_number, $1) WHERE id = $2',
    [number + 1, documentId]);
  await client.query("UPDATE app.storage_intents SET state = 'attached' WHERE id = $1", [intentId]);
  await client.query(`INSERT INTO app.document_chunks(id, team_id, document_id, version_id,
    embedding_profile_id, embedding_dimensions, chunk_ordinal, location_kind, line_start, line_end,
    content_text, content_sha256, embedding)
    VALUES ($1, $2, $3, $4, $5, 3, 0, 'lines', 1, 3, 'Test-only source content', $6, '[1,0,0]')`,
  [chunkId, teamId, documentId, versionId, profile, checksum]);
  if (ready) {
    await client.query("UPDATE app.document_versions SET state = 'ready', ready_at = clock_timestamp() WHERE id = $1", [versionId]);
    await client.query('UPDATE app.documents SET current_version_id = $1 WHERE id = $2', [versionId, documentId]);
  }
  return { documentId, teamId, versionId, chunkId, intentId, profileId: profile };
}

export async function grantSalary(client: Client, membershipId: string = demo.memberships.saraHr): Promise<string> {
  const id = randomUUID();
  await client.query(`INSERT INTO app.document_grants(id, team_id, document_id, grantee_membership_id, granted_by_membership_id)
    VALUES ($1, $2, $3, $4, $5)`, [id, demo.hr, demo.documents.salary, membershipId, demo.memberships.hina]);
  return id;
}

export async function createAnswer(client: Client, identity: IdentityContext, sources: VersionFixture[],
  expectedCount = sources.length, citeFirst = true): Promise<{ messageId: string; conversationId: string; requestId: string; userMessageId: string }> {
  const conversationId = randomUUID();
  const requestId = randomUUID();
  const messageId = randomUUID();
  const userMessageId = randomUUID();
  const periodId = randomUUID();
  await client.query('BEGIN');
  try {
    await client.query('INSERT INTO app.conversations(id, team_id, owner_membership_id) VALUES ($1, $2, $3)',
      [conversationId, identity.teamId, identity.membershipId]);
    const period = await client.query<{ id: string }>(`INSERT INTO app.usage_periods(id, team_id, period_start, period_end)
      VALUES ($1, $2, '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z')
      ON CONFLICT (team_id, period_start) DO UPDATE SET held_count = app.usage_periods.held_count RETURNING id`,
    [periodId, identity.teamId]);
    await client.query(`INSERT INTO app.usage_reservations(id, team_id, owner_membership_id, conversation_id,
      idempotency_key, request_fingerprint) VALUES ($1, $2, $3, $4, $5, $6)`,
    [requestId, identity.teamId, identity.membershipId, conversationId, randomUUID(), checksum]);
    await client.query(`INSERT INTO app.usage_attempts(team_id, reservation_id, attempt_number, period_id, lease_expires_at)
      VALUES ($1, $2, 1, $3, clock_timestamp() + interval '10 minutes')`, [identity.teamId, requestId, period.rows[0]!.id]);
    await client.query('UPDATE app.usage_reservations SET current_attempt_number = 1 WHERE id = $1', [requestId]);
    await client.query(`INSERT INTO app.messages(id, team_id, owner_membership_id, conversation_id, request_id, kind, body_text)
      VALUES ($1, $2, $3, $4, $5, 'user', 'Test-only question')`,
    [userMessageId, identity.teamId, identity.membershipId, conversationId, requestId]);
    await client.query(`INSERT INTO app.messages(id, team_id, owner_membership_id, conversation_id, request_id,
      kind, body_text, answer_kind, expected_source_count)
      VALUES ($1, $2, $3, $4, $5, 'assistant', 'Test-only assistant answer', 'grounded', $6)`,
    [messageId, identity.teamId, identity.membershipId, conversationId, requestId, expectedCount]);
    for (const [index, source] of sources.entries()) {
      await client.query(`INSERT INTO app.message_sources(team_id, owner_membership_id, message_id,
        document_id, version_id, chunk_id, chunk_ordinal, context_ordinal, source_label, is_cited,
        location_kind, line_start, line_end)
        VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, 'lines', 1, 3)`,
      [identity.teamId, identity.membershipId, messageId, source.documentId, source.versionId,
        source.chunkId, index, `S${index + 1}`, citeFirst && index === 0]);
    }
    await client.query('UPDATE app.messages SET finalized_at = clock_timestamp() WHERE id = $1', [messageId]);
    await client.query("UPDATE app.usage_attempts SET state = 'charged', finalized_at = clock_timestamp() WHERE reservation_id = $1", [requestId]);
    await client.query("UPDATE app.usage_reservations SET status = 'completed', completed_at = clock_timestamp() WHERE id = $1", [requestId]);
    await client.query('UPDATE app.usage_periods SET used_count = used_count + 1 WHERE id = $1', [period.rows[0]!.id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  return { messageId, conversationId, requestId, userMessageId };
}
