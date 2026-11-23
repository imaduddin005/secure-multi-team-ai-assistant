CREATE SCHEMA app AUTHORIZATION app_owner;
CREATE SCHEMA app_private AUTHORIZATION app_owner;
REVOKE ALL ON SCHEMA app, app_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE app.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject uuid NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE app.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  authz_epoch bigint NOT NULL DEFAULT 0 CHECK (authz_epoch >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, slug)
);

CREATE TABLE app.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  user_id uuid NOT NULL REFERENCES app.users(id),
  role text NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_at timestamptz CHECK (removed_at >= joined_at),
  UNIQUE (id, team_id),
  UNIQUE (id, team_id, user_id)
);
CREATE UNIQUE INDEX memberships_one_active ON app.memberships(team_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX memberships_user_active ON app.memberships(user_id, team_id) WHERE removed_at IS NULL;
CREATE INDEX memberships_admins ON app.memberships(team_id, role) WHERE removed_at IS NULL;

CREATE TABLE app.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  created_by_membership_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  visibility text NOT NULL DEFAULT 'restricted' CHECK (visibility IN ('team', 'restricted')),
  next_version_number integer NOT NULL DEFAULT 1 CHECK (next_version_number > 0),
  current_version_id uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, team_id),
  FOREIGN KEY (created_by_membership_id, team_id) REFERENCES app.memberships(id, team_id),
  CHECK (deleted_at IS NULL OR current_version_id IS NULL)
);
CREATE INDEX documents_live_team ON app.documents(team_id, created_at, id) WHERE deleted_at IS NULL;

CREATE TABLE app.document_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  document_id uuid NOT NULL,
  grantee_membership_id uuid NOT NULL,
  granted_by_membership_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revoked_by_membership_id uuid,
  revoked_by_system text,
  FOREIGN KEY (document_id, team_id) REFERENCES app.documents(id, team_id),
  FOREIGN KEY (grantee_membership_id, team_id) REFERENCES app.memberships(id, team_id),
  FOREIGN KEY (granted_by_membership_id, team_id) REFERENCES app.memberships(id, team_id),
  FOREIGN KEY (revoked_by_membership_id, team_id) REFERENCES app.memberships(id, team_id),
  CHECK ((revoked_at IS NULL AND revoked_by_membership_id IS NULL AND revoked_by_system IS NULL)
    OR (revoked_at IS NOT NULL AND num_nonnulls(revoked_by_membership_id, revoked_by_system) = 1)),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (revoked_by_system IS NULL OR length(revoked_by_system) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX grants_one_live ON app.document_grants(document_id, grantee_membership_id) WHERE revoked_at IS NULL;
CREATE INDEX grants_membership_live ON app.document_grants(grantee_membership_id, document_id) WHERE revoked_at IS NULL;

CREATE TABLE app.embedding_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text NOT NULL UNIQUE CHECK (length(btrim(profile_key)) BETWEEN 1 AND 120),
  provider_id text NOT NULL CHECK (length(btrim(provider_id)) BETWEEN 1 AND 120),
  model_id text NOT NULL CHECK (length(btrim(model_id)) BETWEEN 1 AND 200),
  dimensions integer NOT NULL CHECK (dimensions BETWEEN 1 AND 16000),
  chunker_version text NOT NULL CHECK (length(btrim(chunker_version)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, dimensions)
);

CREATE TABLE app.storage_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  uploader_membership_id uuid NOT NULL,
  target_document_id uuid,
  bucket text NOT NULL CHECK (length(btrim(bucket)) BETWEEN 1 AND 120),
  object_key text NOT NULL UNIQUE CHECK (length(btrim(object_key)) BETWEEN 1 AND 512),
  state text NOT NULL DEFAULT 'allocated'
    CHECK (state IN ('allocated', 'uploaded', 'attached', 'cleanup_pending', 'purged', 'failed')),
  lease_token bigint NOT NULL DEFAULT 0 CHECK (lease_token >= 0),
  lease_expires_at timestamptz,
  actual_byte_size bigint CHECK (actual_byte_size BETWEEN 1 AND 20971520),
  content_sha256 text CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  last_error_code text CHECK (length(last_error_code) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, team_id),
  FOREIGN KEY (uploader_membership_id, team_id) REFERENCES app.memberships(id, team_id),
  FOREIGN KEY (target_document_id, team_id) REFERENCES app.documents(id, team_id)
);
CREATE INDEX storage_intents_recovery ON app.storage_intents(state, lease_expires_at, updated_at);

CREATE TABLE app.document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  team_id uuid NOT NULL REFERENCES app.teams(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  created_by_membership_id uuid NOT NULL,
  storage_intent_id uuid NOT NULL UNIQUE,
  original_filename text NOT NULL CHECK (length(btrim(original_filename)) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'text/plain')),
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'processing', 'ready', 'failed', 'purged')),
  embedding_profile_id uuid,
  embedding_dimensions integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ready_at timestamptz,
  failure_code text CHECK (length(failure_code) BETWEEN 1 AND 80),
  UNIQUE (document_id, version_number),
  UNIQUE (id, document_id, team_id),
  UNIQUE (id, document_id, team_id, embedding_profile_id, embedding_dimensions),
  FOREIGN KEY (document_id, team_id) REFERENCES app.documents(id, team_id),
  FOREIGN KEY (created_by_membership_id, team_id) REFERENCES app.memberships(id, team_id),
  FOREIGN KEY (storage_intent_id, team_id) REFERENCES app.storage_intents(id, team_id),
  FOREIGN KEY (embedding_profile_id, embedding_dimensions) REFERENCES app.embedding_profiles(id, dimensions),
  CHECK ((embedding_profile_id IS NULL) = (embedding_dimensions IS NULL)),
  CHECK (state <> 'ready' OR (embedding_profile_id IS NOT NULL AND ready_at IS NOT NULL)),
  CHECK (state <> 'failed' OR failure_code IS NOT NULL)
);
ALTER TABLE app.documents ADD CONSTRAINT documents_current_version_fk
  FOREIGN KEY (current_version_id, id, team_id)
  REFERENCES app.document_versions(id, document_id, team_id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX versions_document_order ON app.document_versions(document_id, version_number DESC);
CREATE INDEX versions_intent_team ON app.document_versions(storage_intent_id, team_id);

CREATE TABLE app.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  document_id uuid NOT NULL,
  version_id uuid NOT NULL,
  embedding_profile_id uuid NOT NULL,
  embedding_dimensions integer NOT NULL,
  chunk_ordinal integer NOT NULL CHECK (chunk_ordinal >= 0),
  location_kind text NOT NULL CHECK (location_kind IN ('page', 'lines')),
  page_start integer,
  page_end integer,
  line_start integer,
  line_end integer,
  content_text text NOT NULL CHECK (length(btrim(content_text)) BETWEEN 1 AND 20000),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  embedding extensions.vector NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (version_id, chunk_ordinal),
  UNIQUE (id, version_id, document_id, team_id, chunk_ordinal),
  FOREIGN KEY (version_id, document_id, team_id, embedding_profile_id, embedding_dimensions)
    REFERENCES app.document_versions(id, document_id, team_id, embedding_profile_id, embedding_dimensions),
  CHECK (extensions.vector_dims(embedding) = embedding_dimensions),
  CHECK ((location_kind = 'page' AND page_start > 0 AND page_end >= page_start
      AND page_start IS NOT NULL AND page_end IS NOT NULL AND line_start IS NULL AND line_end IS NULL)
    OR (location_kind = 'lines' AND line_start > 0 AND line_end >= line_start
      AND line_start IS NOT NULL AND line_end IS NOT NULL AND page_start IS NULL AND page_end IS NULL))
);
CREATE INDEX chunks_team_version ON app.document_chunks(team_id, version_id, chunk_ordinal);

CREATE TABLE app.processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  kind text NOT NULL CHECK (kind IN ('process_version', 'purge_document', 'purge_storage_intent')),
  document_id uuid,
  version_id uuid,
  storage_intent_id uuid,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'leased', 'succeeded', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  lease_token bigint NOT NULL DEFAULT 0 CHECK (lease_token >= 0),
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_error_code text CHECK (length(last_error_code) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, team_id),
  FOREIGN KEY (document_id, team_id) REFERENCES app.documents(id, team_id),
  FOREIGN KEY (version_id, document_id, team_id) REFERENCES app.document_versions(id, document_id, team_id),
  FOREIGN KEY (storage_intent_id, team_id) REFERENCES app.storage_intents(id, team_id),
  CHECK ((kind = 'process_version' AND document_id IS NOT NULL AND version_id IS NOT NULL AND storage_intent_id IS NULL)
    OR (kind = 'purge_document' AND document_id IS NOT NULL AND version_id IS NULL AND storage_intent_id IS NULL)
    OR (kind = 'purge_storage_intent' AND document_id IS NULL AND version_id IS NULL AND storage_intent_id IS NOT NULL)),
  CHECK (attempts <= max_attempts),
  CHECK ((state = 'leased' AND lease_expires_at IS NOT NULL AND attempts > 0)
    OR (state <> 'leased' AND lease_expires_at IS NULL))
);
CREATE UNIQUE INDEX jobs_one_process_version ON app.processing_jobs(version_id) WHERE kind = 'process_version';
CREATE UNIQUE INDEX jobs_one_document_purge ON app.processing_jobs(document_id) WHERE kind = 'purge_document';
CREATE UNIQUE INDEX jobs_one_intent_purge ON app.processing_jobs(storage_intent_id) WHERE kind = 'purge_storage_intent';
CREATE INDEX jobs_recovery ON app.processing_jobs(state, next_attempt_at, lease_expires_at);

CREATE TABLE app.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  job_id uuid NOT NULL,
  event_type text NOT NULL DEFAULT 'dispatch_job' CHECK (event_type = 'dispatch_job'),
  dedupe_key text NOT NULL UNIQUE CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'published')),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  last_error_code text CHECK (length(last_error_code) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (job_id, team_id) REFERENCES app.processing_jobs(id, team_id),
  UNIQUE (job_id, event_type),
  CHECK ((state = 'published') = (published_at IS NOT NULL))
);
CREATE INDEX outbox_pending ON app.outbox_events(available_at, id) WHERE state = 'pending';

CREATE TABLE app.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  owner_membership_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'New chat' CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz,
  UNIQUE (id, team_id, owner_membership_id),
  FOREIGN KEY (owner_membership_id, team_id) REFERENCES app.memberships(id, team_id)
);
CREATE INDEX conversations_owner ON app.conversations(owner_membership_id, created_at, id) WHERE deleted_at IS NULL;

CREATE TABLE app.usage_budgets (
  team_id uuid PRIMARY KEY REFERENCES app.teams(id),
  monthly_answer_limit integer NOT NULL DEFAULT 1000 CHECK (monthly_answer_limit >= 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_membership_id uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (updated_by_membership_id, team_id) REFERENCES app.memberships(id, team_id)
);

CREATE TABLE app.usage_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  used_count bigint NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  held_count bigint NOT NULL DEFAULT 0 CHECK (held_count >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (team_id, period_start),
  UNIQUE (id, team_id),
  CHECK ((period_start AT TIME ZONE 'UTC') = date_trunc('month', period_start AT TIME ZONE 'UTC')),
  CHECK (period_end = (((period_start AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC'))
);

CREATE TABLE app.usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  owner_membership_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'retryable_failed', 'blocked')),
  current_attempt_number integer CHECK (current_attempt_number > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (team_id, owner_membership_id, idempotency_key),
  UNIQUE (id, team_id),
  UNIQUE (id, team_id, owner_membership_id, conversation_id),
  FOREIGN KEY (owner_membership_id, team_id) REFERENCES app.memberships(id, team_id),
  FOREIGN KEY (conversation_id, team_id, owner_membership_id) REFERENCES app.conversations(id, team_id, owner_membership_id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);

CREATE TABLE app.usage_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  reservation_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  period_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'charged', 'released', 'expired')),
  lease_expires_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  provider_started_at timestamptz,
  finalized_at timestamptz,
  outcome_code text CHECK (length(outcome_code) BETWEEN 1 AND 80),
  UNIQUE (reservation_id, attempt_number),
  FOREIGN KEY (reservation_id, team_id) REFERENCES app.usage_reservations(id, team_id),
  FOREIGN KEY (period_id, team_id) REFERENCES app.usage_periods(id, team_id),
  CHECK ((state = 'held') = (finalized_at IS NULL)),
  CHECK (lease_expires_at > started_at)
);
ALTER TABLE app.usage_reservations ADD CONSTRAINT reservations_current_attempt_fk
  FOREIGN KEY (id, current_attempt_number) REFERENCES app.usage_attempts(reservation_id, attempt_number)
  DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX attempts_one_hold ON app.usage_attempts(reservation_id) WHERE state = 'held';
CREATE INDEX attempts_expiry ON app.usage_attempts(lease_expires_at, id) WHERE state = 'held';
CREATE INDEX attempts_period_state ON app.usage_attempts(period_id, state);

CREATE TABLE app.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  owner_membership_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  request_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('user', 'assistant')),
  body_text text NOT NULL CHECK (length(btrim(body_text)) BETWEEN 1 AND 100000),
  answer_kind text CHECK (answer_kind IN ('grounded', 'insufficient_sources')),
  expected_source_count integer CHECK (expected_source_count >= 0),
  finalized_at timestamptz,
  permanently_unavailable_at timestamptz,
  unavailable_reason text CHECK (unavailable_reason IN ('deleted_source', 'purged_source')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (request_id, kind),
  UNIQUE (id, team_id, owner_membership_id, kind),
  FOREIGN KEY (conversation_id, team_id, owner_membership_id) REFERENCES app.conversations(id, team_id, owner_membership_id),
  FOREIGN KEY (request_id, team_id, owner_membership_id, conversation_id)
    REFERENCES app.usage_reservations(id, team_id, owner_membership_id, conversation_id),
  CHECK ((kind = 'user' AND answer_kind IS NULL AND expected_source_count IS NULL
      AND finalized_at IS NULL AND permanently_unavailable_at IS NULL AND unavailable_reason IS NULL)
    OR (kind = 'assistant' AND answer_kind IS NOT NULL AND expected_source_count IS NOT NULL)),
  CHECK ((permanently_unavailable_at IS NULL) = (unavailable_reason IS NULL))
);
CREATE INDEX messages_conversation ON app.messages(conversation_id, created_at, id);
CREATE INDEX messages_owner ON app.messages(owner_membership_id, team_id);

CREATE TABLE app.message_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  owner_membership_id uuid NOT NULL,
  message_id uuid NOT NULL,
  message_kind text NOT NULL DEFAULT 'assistant' CHECK (message_kind = 'assistant'),
  document_id uuid NOT NULL,
  version_id uuid NOT NULL,
  chunk_id uuid,
  chunk_ordinal integer NOT NULL CHECK (chunk_ordinal >= 0),
  context_ordinal integer NOT NULL CHECK (context_ordinal >= 0),
  source_label text NOT NULL,
  is_cited boolean NOT NULL DEFAULT false,
  location_kind text NOT NULL CHECK (location_kind IN ('page', 'lines')),
  page_start integer,
  page_end integer,
  line_start integer,
  line_end integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (message_id, team_id, owner_membership_id, message_kind)
    REFERENCES app.messages(id, team_id, owner_membership_id, kind),
  FOREIGN KEY (document_id, team_id) REFERENCES app.documents(id, team_id),
  FOREIGN KEY (version_id, document_id, team_id) REFERENCES app.document_versions(id, document_id, team_id),
  FOREIGN KEY (chunk_id, version_id, document_id, team_id, chunk_ordinal)
    REFERENCES app.document_chunks(id, version_id, document_id, team_id, chunk_ordinal),
  UNIQUE (message_id, version_id, chunk_ordinal),
  UNIQUE (message_id, context_ordinal),
  UNIQUE (message_id, source_label),
  CHECK (source_label = 'S' || (context_ordinal + 1)::text),
  CHECK ((location_kind = 'page' AND page_start > 0 AND page_end >= page_start
      AND page_start IS NOT NULL AND page_end IS NOT NULL AND line_start IS NULL AND line_end IS NULL)
    OR (location_kind = 'lines' AND line_start > 0 AND line_end >= line_start
      AND line_start IS NOT NULL AND line_end IS NOT NULL AND page_start IS NULL AND page_end IS NULL))
);
CREATE INDEX sources_document ON app.message_sources(document_id, message_id);
CREATE INDEX sources_version ON app.message_sources(version_id, message_id);
CREATE INDEX sources_chunk ON app.message_sources(chunk_id);

CREATE TABLE app.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES app.teams(id),
  owner_membership_id uuid NOT NULL,
  user_id uuid NOT NULL,
  message_id uuid NOT NULL,
  message_kind text NOT NULL DEFAULT 'assistant' CHECK (message_kind = 'assistant'),
  rating text NOT NULL CHECK (rating IN ('helpful', 'unhelpful')),
  comment text CHECK (length(comment) <= 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (user_id, message_id),
  FOREIGN KEY (owner_membership_id, team_id, user_id) REFERENCES app.memberships(id, team_id, user_id),
  FOREIGN KEY (message_id, team_id, owner_membership_id, message_kind)
    REFERENCES app.messages(id, team_id, owner_membership_id, kind)
);

CREATE TABLE app.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid REFERENCES app.teams(id),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'system', 'anonymous')),
  actor_user_id uuid REFERENCES app.users(id),
  actor_membership_id uuid,
  system_actor text,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  target_type text NOT NULL CHECK (length(target_type) BETWEEN 1 AND 80),
  target_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 4096),
  FOREIGN KEY (actor_membership_id, team_id, actor_user_id) REFERENCES app.memberships(id, team_id, user_id),
  CHECK (actor_membership_id IS NULL OR (team_id IS NOT NULL AND actor_user_id IS NOT NULL)),
  CHECK ((actor_kind = 'user' AND actor_user_id IS NOT NULL AND system_actor IS NULL)
    OR (actor_kind = 'system' AND actor_user_id IS NULL AND actor_membership_id IS NULL
      AND system_actor IS NOT NULL AND length(system_actor) BETWEEN 1 AND 120)
    OR (actor_kind = 'anonymous' AND actor_user_id IS NULL AND actor_membership_id IS NULL AND system_actor IS NULL))
);
CREATE INDEX audit_team_time ON app.audit_logs(team_id, occurred_at DESC, id);
CREATE INDEX audit_target_time ON app.audit_logs(target_type, target_id, occurred_at);
