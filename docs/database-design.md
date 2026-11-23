# Architecture and database blueprint

This document records the design-first blueprint and 21-table catalog. The SQL foundations and later API/worker/quota/chat modules are now implemented; current execution evidence is tracked in `module-progress.md` and `verification-evidence.md`. Historical future-tense wording below describes the original design contract, not a claim that those modules remain absent. Proposed business choices still require learner review; see `design-decisions.md`.

## 1. Responsibilities and trust boundaries

| Component | Owns | Must not be trusted to do |
| --- | --- | --- |
| Next.js / TypeScript / Tailwind | Login UI, selected-team UI, document/chat/admin views | Authorize requests by hiding buttons or accepting client roles |
| Supabase Auth | Account authentication and signed identity tokens | Encode authoritative current app membership/role/grants |
| NestJS on Node.js | Token verification, runtime input checks, current permissions, service orchestration, safe output | Trust body/query user IDs or rely on model instructions for access control |
| PostgreSQL + pgvector | Canonical records, constraints, transactions, RLS, vector ranking | Store original object bytes or pretend a DB commit also commits Redis/Storage |
| Private Supabase Storage | Original file bytes under opaque server-generated keys | Decide app ACLs merely from bucket privacy or object ownership |
| BullMQ + Redis | Work delivery, delay/backoff | Be the only record that processing/purge work is required |
| Worker / reconciler | Durable jobs, parsing, chunks/embedding, activation/purge, recovery | Restore deleted documents or accept stale leases |
| Embedding / answer adapters | External model calls with bounded requests | Receive unauthorized evidence or be a database/storage/network tool agent |

Browser → API is untrusted input. API → PostgreSQL is a trusted identity-context boundary, but runtime SQL privileges are limited. API/worker → Storage uses powerful private server credentials. API/worker → external providers crosses a data-processing boundary: only authorized evidence may be assembled for the answer call. Provider contract/retention and infrastructure operators remain outside the app's authorization guarantee. Redis payloads contain job IDs and safe correlation data, never source text or secrets.

## 2. Shared schema conventions

- Primary IDs are server-generated UUIDs, except the one-per-team budget whose PK is `team_id`. All PKs are non-null.
- Times are `timestamptz`, generated/compared by PostgreSQL. Calendar periods are explicitly UTC.
- Child business rows carry `team_id`; global profiles and embedding profiles do not. Organization is derived through `teams.organization_id`, preventing duplicate organization fields from disagreeing.
- Every referenced team-scoped row has an explicit unique key including `team_id`. A child FK includes both target ID and team ID, even if the target UUID is globally unique.
- Content and original file revisions are immutable. State, leases, current pointers, revoked timestamps, and lifecycle metadata change only through controlled commands.
- `ON DELETE RESTRICT` is the default. No ordinary cascade may erase provenance/audit before invalidation. Pure owned chat rows may be explicitly purged in an authorized deletion transaction after quota replay keys are preserved.
- Enum-like values use constrained text or PostgreSQL enums selected in Module 1; the allowed values below are the contract. Nonblank bounded strings and nonnegative counters are checked.
- A simple `CHECK` cannot enforce a condition over other changing rows. Active-member grants, current-ready activation, last-admin, quota accounting, provenance completeness, and invalidation ordering require constrained privileges plus transaction commands/triggers, not an unsupported cross-table `CHECK` claim.

## 3. Table catalog

### organizations

`id` PK; `name`; `slug` unique; `created_at`. TechCo is one row. No organization deletion or organization-wide admin capability is exposed in the MVP.

### users

`id` PK; `auth_subject` UUID unique; `display_name`; `created_at`. The fixed deployment Auth issuer plus verified token `sub` identify this profile. No password, global role, or team list lives here. `auth_subject` is an external identity reference, **not** an FK to a remote Auth database. Local test fixtures do not prove a matching Auth account exists. Account-wide token/session invalidation semantics are separate from immediate membership revocation; a valid cached JWT can remain cryptographically valid until expiry. Module 2 must document that boundary and its verification strategy.

### teams

`id` PK; `organization_id` FK → organizations; `name`; `slug`; `authz_epoch bigint >= 0`; `created_at`. Unique `(organization_id, slug)`. HR and Engineering are two rows. `authz_epoch` is bumped on permission/deletion changes to invalidate future protected caches; epoch values alone never replace source checks. The team row is the locking gate.

### memberships

`id` PK; `team_id` FK → teams; `user_id` FK → users; `role` in `viewer/editor/admin`; `joined_at`; nullable `removed_at`. Check removal is not earlier than joining. Unique `(id, team_id)` and `(id, team_id, user_id)` support downstream FKs. Partial unique `(team_id, user_id) WHERE removed_at IS NULL`. Team/user identifiers are immutable. Role is mutable only while active; removal is terminal. Sara has two separate rows. No FK alone ensures a referenced membership is active; commands and read policies must check `removed_at IS NULL`.

### documents

`id` PK; `team_id`; `created_by_membership_id`; protected `title`; `visibility` in `restricted/team` default restricted; `next_version_number integer >= 1`; nullable `current_version_id`; nullable `deleted_at`; `created_at`; `updated_at`.

FK `(created_by_membership_id, team_id)` → memberships. Unique `(id, team_id)`. Composite FK `(current_version_id, id, team_id)` → document_versions `(id, document_id, team_id)`, deferrable for initial creation. A tombstone must have a null current pointer. The FK ensures ownership/team consistency, while activation commands ensure the target is ready and monotone. The title is not a safe public identifier; permission applies to it even before a version is ready. `team_id` cannot change.

### document_grants

`id` PK; `team_id`; `document_id`; `grantee_membership_id`; `granted_by_membership_id`; `created_at`; nullable `revoked_at`; nullable `revoked_by_membership_id`; nullable `revoked_by_system`. FKs `(document_id, team_id)` → documents and each membership/team pair → memberships. All grant creators are user memberships in the MVP, including the uploader's initial grant. Partial unique `(document_id, grantee_membership_id) WHERE revoked_at IS NULL`; a revocation requires exactly one human-membership or system actor, and an unrevoked row has neither. `revoked_by_system` was added in Module 1 for truthful automatic membership-removal attribution. Revoked rows are not reactivated: regrant creates a new row. Removing a member also revokes that membership's current grants in the same transaction. Read requires an active grantee membership in addition to the row.

### embedding_profiles

`id` PK; `profile_key` unique; `provider_id`; `model_id`; `dimensions integer > 0`; `chunker_version`; `created_at`. Unique `(id, dimensions)`. Immutable after use. The actual provider/model/dimensions are not selected in Module 0. A deployment starts with one compatible retrieval profile; changes require an explicit re-embedding rollout. This extra table makes a vector's meaning reproducible instead of treating every numeric array as interchangeable.

### storage_intents

`id` PK; `team_id`; `uploader_membership_id`; nullable `target_document_id` for an existing-document replacement; `bucket`; unique `object_key`; `state` in `allocated/uploaded/attached/cleanup_pending/purged/failed`; `lease_token bigint >= 0`; nullable `lease_expires_at`; nullable `actual_byte_size`; nullable `content_sha256`; nullable `last_error_code`; `created_at`; `updated_at`. Unique `(id, team_id)`. Composite membership/document FKs prevent another team's intent from being attached to an upload.

An intent is persisted before any storage call. A version later references it; the intent needs no circular `version_id` field. `attached` is verified through that reference by the finalization command. Cleanup claims/rechecks an intent under a fence; an expired upload cannot attach after cleanup won. The object path is an internal secret-bearing locator, never an access token or a user-provided path. This extra ledger closes the known upload-success/DB-failure discovery gap for managed uploads.

The fence cannot stop a delayed external PUT from creating bytes after a cleanup delete. Recheck unreferenced/recently purged intent keys after the upload timeout/grace and use periodic bucket inventory after intent compaction. A late object is never readable through the app, but its physical cleanup is eventual and service-dependent.

### document_versions

`id` PK; `document_id`; `team_id`; `version_number integer >= 1`; `created_by_membership_id`; unique `storage_intent_id`; protected `original_filename`; `mime_type` in `application/pdf/text/plain`; `byte_size` in `1..20971520`; `content_sha256`; `state` in `queued/processing/ready/failed/purged`; nullable `embedding_profile_id`; nullable `embedding_dimensions`; `created_at`; nullable `ready_at`; nullable `failure_code`.

FK `(document_id, team_id)` → documents; uploader/team → memberships; intent/team → storage_intents; `(embedding_profile_id, embedding_dimensions)` → embedding_profiles `(id, dimensions)`. Profile ID/dimension are both null or both set; ready requires them and `ready_at`. Profile is assigned once before chunk creation; file metadata/revision number stay immutable. Unique `(document_id, version_number)`, `(id, document_id, team_id)`, and `(id, document_id, team_id, embedding_profile_id, embedding_dimensions)` support exact references. `purged` is a tombstone retaining no extracted text or object bytes. Multiple old versions can remain ready, but only the document's current pointer is retrieval-eligible.

### document_chunks

`id` PK; `team_id`; `document_id`; `version_id`; `embedding_profile_id`; `embedding_dimensions`; `chunk_ordinal integer >= 0`; `location_kind` in `page/lines`; `page_start/page_end` or `line_start/line_end`; `content_text`; `content_sha256`; `embedding vector`; `created_at`.

Composite FK `(version_id, document_id, team_id, embedding_profile_id, embedding_dimensions)` → the version signature. Unique `(version_id, chunk_ordinal)` and `(id, version_id, document_id, team_id, chunk_ordinal)`. The extended source-reference key also prevents a source from lying about its chunk ordinal. Check `vector_dims(embedding) = embedding_dimensions`; check a nonempty chunk and the correct positive ordered location pair, with the other pair null. The base vector type permits dimensions to be recorded before the chosen provider is pinned; cross-profile comparisons are forbidden. Worker commands check version/job/profile/fence, replace incomplete staging atomically, and prohibit modification after ready. No independent `is_active` flag can drift from the current version pointer.

### processing_jobs

`id` PK; `team_id`; `kind` in `process_version/purge_document/purge_storage_intent`; nullable `document_id`; nullable `version_id`; nullable `storage_intent_id`; `state` in `pending/leased/succeeded/failed/cancelled`; `attempts >= 0`; `max_attempts > 0`; `lease_token bigint >= 0`; nullable `lease_expires_at`; `next_attempt_at`; nullable `last_error_code`; `created_at`; `updated_at`. Unique `(id, team_id)`.

Target checks: processing requires document + version and no storage-intent target; document purge requires only document; orphan cleanup requires only storage intent. Composite FKs pin target team and version/document association. Partial unique target indexes allow one logical job per process-version, document-purge, or orphan-intent operation. Each attempt increments a database fence; Redis delivery count is not authority. Error codes are sanitized, never raw provider/parser text. Cancellation/deletion makes late work ineligible.

### outbox_events

`id` PK; `team_id`; `job_id`; `event_type` fixed to `dispatch_job` for the MVP; unique `dedupe_key`; `state` in `pending/published`; `available_at`; nullable `published_at`; `publish_attempts >= 0`; nullable `last_error_code`; `created_at`. FK `(job_id, team_id)` → processing_jobs; unique `(job_id, event_type)`. Target/job creation and outbox insertion commit together. Marking published is not proof the job completed; reconciliation can reset/re-publish a nonterminal database job. This extra table makes publication repairable after crashes.

### conversations

`id` PK; `team_id`; `owner_membership_id`; `title` generic or explicitly user-supplied; `created_at`; nullable `deleted_at`. FK owner/team → memberships. Unique `(id, team_id, owner_membership_id)`. Conversation team and owner are immutable. No admin override. No model-created preview/title is stored outside answer provenance controls.

### messages

`id` PK; `team_id`; `owner_membership_id`; `conversation_id`; `request_id`; `kind` in `user/assistant`; `body_text`; nullable `answer_kind` in `grounded/insufficient_sources`; assistant `expected_source_count`; nullable `finalized_at`; nullable `permanently_unavailable_at`; nullable `unavailable_reason` in `deleted_source/purged_source`; `created_at`.

FK `(conversation_id, team_id, owner_membership_id)` → conversations; `(request_id, team_id, owner_membership_id, conversation_id)` → usage_reservations. Unique `(request_id, kind)` permits one user/assistant pair per logical request. Unique `(id, team_id, owner_membership_id, kind)` supports assistant-only source/feedback FKs. User messages cannot have assistant kind/invalidation/finalization fields; assistant messages must have an answer kind and expected source count. Added in Module 1, `finalized_at` and `expected_source_count` support deferred provenance completeness, with sources attached before finalization in one transaction. The database verifies the recorded set; the later orchestrator must prove that it matches every chunk actually supplied to the provider. Permanent-unavailability reason/time are paired. Body may remain stored after invalidation but is inaccessible through runtime read policies/projections. Explicit conversation purge removes it. No historical answer body is factual input to future generation.

### message_sources

`id` PK; `team_id`; `owner_membership_id`; `message_id`; `message_kind` constrained to `assistant`; `document_id`; `version_id`; nullable `chunk_id`; `chunk_ordinal`; `context_ordinal`; `source_label`; `is_cited boolean`; relevant page/line locations; `created_at`.

FK `(message_id, team_id, owner_membership_id, message_kind)` → messages; `(version_id, document_id, team_id)` → document_versions; `(document_id, team_id)` → documents; `(chunk_id, version_id, document_id, team_id, chunk_ordinal)` → document_chunks. Unique `(message_id, version_id, chunk_ordinal)`, `(message_id, context_ordinal)`, `(message_id, source_label)`. Store every unique supplied chunk, including uncited ones; source labels are server allocated. Locations must match the referenced chunk. No source text/title/filename snapshot is copied here. The nullable chunk pointer is only cleared by purge **after** permanent answer invalidation; preserved document/version/ordinal still identifies provenance. A command/trigger enforces that lifecycle rule; nullable FKs alone do not.

### feedback

`id` PK; `team_id`; `owner_membership_id`; `user_id`; `message_id`; `message_kind` fixed assistant; `rating` in `helpful/unhelpful`; nullable bounded `comment`; `created_at`; `updated_at`. FK `(owner_membership_id, team_id, user_id)` → memberships and `(message_id, team_id, owner_membership_id, message_kind)` → messages. Unique `(user_id, message_id)` implements one current user rating per assistant answer, with updates allowed. Current membership, ownership, and complete provenance access are rechecked on reads/writes. Feedback comments are private content, excluded from audit/admin views.

### usage_budgets

`team_id` PK/FK → teams; `monthly_answer_limit integer >= 0` default 1000; `revision bigint >= 1`; nullable `updated_by_membership_id`; `updated_at`. FK `(updated_by_membership_id, team_id)` → memberships. Editor of budget, when a user, must be a same-team active admin; system initialization uses null plus a system audit actor. One row is created with every team. Row count limits and provider spending are different concepts.

### usage_periods

`id` PK; `team_id`; `period_start`; `period_end`; `used_count bigint >= 0`; `held_count bigint >= 0`; `created_at`. Unique `(team_id, period_start)` and `(id, team_id)`. Boundaries are first-of-month midnight UTC and the next UTC month; calculate/check with explicit UTC conversion, independent of session timezone. No `used + held <= budget` CHECK is used because lowering a budget must not corrupt historical charges/holds. Counters are materialized for atomic admission and reconciled against the attempt ledger by maintenance; no Redis counter is authoritative.

### usage_reservations

Logical request/idempotency row: `id` PK; `team_id`; `owner_membership_id`; `conversation_id`; `idempotency_key`; `request_fingerprint`; `status` in `in_progress/completed/retryable_failed/blocked`; nullable `current_attempt_number`; `created_at`; nullable `completed_at`.

Owner/team FK → memberships; conversation/owner/team FK → conversations. Unique `(team_id, owner_membership_id, idempotency_key)`, `(id, team_id)`, `(id, team_id, owner_membership_id, conversation_id)`. A same key with a different fingerprint is rejected. Deferred FK `(id, current_attempt_number)` → usage_attempts `(reservation_id, attempt_number)` supports initial insertion. The completed output is obtained from the unique assistant message, not a second copied answer. Completed replay keys remain after conversation purge; that purge keeps an opaque conversation tombstone and request metadata but no question/answer fingerprint input text. Requests for that purged result return unavailable, never regenerate.

### usage_attempts

`id` PK; `team_id`; `reservation_id`; `attempt_number integer > 0`; `period_id`; `state` in `held/charged/released/expired`; `lease_expires_at`; `started_at`; nullable `provider_started_at`; nullable `finalized_at`; nullable `outcome_code`. FK `(reservation_id, team_id)` → usage_reservations; `(period_id, team_id)` → usage_periods. Unique `(reservation_id, attempt_number)`; partial unique `(reservation_id) WHERE state = 'held'`. The monotonically increasing attempt number is its fencing token. Module 1 makes terminal attempts fully immutable; annotations must be finalized with the attempt. Completion requires the current token, held state, and a live lease using database wall-clock time; the settlement service is Module 5 work. Provider token/cost billing is not part of this table's guarantee.

### audit_logs

`id` PK; nullable `team_id`; `actor_kind` in `user/system/anonymous`; nullable `actor_user_id`; nullable `actor_membership_id`; nullable `system_actor`; `action`; `target_type`; nullable `target_id` UUID; `occurred_at`; `request_id`; allowlisted `details jsonb`.

FK team → teams, actor user → users, `(actor_membership_id, team_id, actor_user_id)` → memberships. Checks require team/user when membership is present, user identity for a user actor, a system name without user IDs for a system actor, and no claimed identity for anonymous events. A pre-authentication security event can lack a team. `target_type/target_id` deliberately form a generic **non-FK** reference; target deletion must not delete evidence. No content or secrets in details. No ordinary update/delete privileges. Admin read projections omit unreadable document events and private-chat targets before counting/pagination.

## 4. Relationship ledger

`1 → N` means one parent can have many child rows; optional means the child's FK can be null. Parent rows may initially have zero children unless a transaction invariant says otherwise.

| Parent → child | Keys | Cardinality and purpose | Invalid state prevented / additional rule |
| --- | --- | --- | --- |
| organizations → teams | `teams.organization_id → organizations.id` | 1 → N: TechCo contains HR and Engineering | Team without an organization |
| users ↔ teams through memberships | `memberships.user_id`, `memberships.team_id` | N ↔ N: Sara has different roles in two teams | Duplicate active user/team membership; global role confusion |
| memberships → documents | `(created_by_membership_id, team_id)` | 1 → N attribution | Cross-team uploader; current role checked at creation |
| documents ↔ memberships through grants | `(document_id, team_id)`, `(grantee_membership_id, team_id)` | N ↔ N restricted readers | Cross-team grant; removed grants never authorize |
| memberships → grant events | `granted_by_membership_id`, optional `revoked_by_membership_id`, each with team | 1 → N audit attribution | Cross-team ACL actor; active admin checked by command |
| documents → versions | `(document_id, team_id)` | 1 → N immutable revisions | Revision assigned to another team's document |
| documents → current version | `(current_version_id, document ID, team_id)` | 0..1 current pointer per document; a version is current for at most its own document | Pointer to another document/team; ready/order rules need command |
| memberships → versions | `(created_by_membership_id, team_id)` | 1 → N revision attribution | Cross-team revision uploader |
| memberships → storage intents | `(uploader_membership_id, team_id)` | 1 → N managed object allocations | Cross-team allocation; removed uploader cannot finalize |
| documents → storage intents | optional `(target_document_id, team_id)` | 1 → N replacement intents | Replacement intent targeting another team |
| storage intents → versions | `(storage_intent_id, team_id)` plus unique intent | 1 → 0..1 attachment | Reusing one original object for multiple version lifecycles |
| embedding profiles → versions | `(embedding_profile_id, embedding_dimensions)` | 1 → N versions, optional before processing | Profile/dimension disagreement |
| versions → chunks | complete version/document/team/profile/dimension signature | 1 → N chunks | Cross-team/document/profile chunks and duplicate ordinals |
| documents/versions/intents → jobs | target-specific composite FKs | Each target has 0..1 logical job per supported operation | Wrong-team target, wrong version/document pair, ambiguous target kind |
| jobs → outbox events | `(job_id, team_id)` | 1 → 0..1 dispatch-event row in this MVP | Orphan/wrong-team publication record |
| memberships → conversations | `(owner_membership_id, team_id)` | 1 → N private chats | Cross-team owner; admin not a conversation owner |
| conversations → requests/messages | conversation/team/owner signature | 1 → N chat requests and messages | Message/request moved into another owner's chat |
| requests → messages | request/team/owner/conversation signature | 1 → at most one message of each kind | Duplicate answers on replay; message in wrong request scope |
| assistant messages → sources | message/team/owner/kind signature | 1 → N potential sources | Sources attached to another team/owner or a user message |
| documents/versions/chunks → sources | document/team, version/document/team, chunk/version/document/team/ordinal | Each source points to exactly its recorded revision/chunk until purge | Cross-team or mismatched citation; no silent source retargeting |
| assistant messages → feedback | message/team/owner/kind signature | 1 → 0..1 owner-user current rating | Rating a user message or someone else's answer |
| memberships/users → feedback | membership/team/user signature | 1 → N ratings across own messages | Substituting another user ID |
| teams → usage budgets | `usage_budgets.team_id` PK/FK | 1 → 1 by team-creation transaction | Multiple budgets; missing budget prohibited by command |
| memberships → budget edits | optional editor/team pair | 1 → N settings changes | Cross-team editor; admin role checked at transaction time |
| teams → usage periods | `usage_periods.team_id` | 1 → N UTC months | Duplicate month counters |
| memberships → requests | owner/team pair | 1 → N idempotent requests | Cross-team quota ownership and duplicate scoped key |
| requests → attempts | request/team pair | 1 → N lease attempts | Wrong-team retry and duplicate attempt number |
| periods → attempts | period/team pair | 1 → N holds/charges | Charging another team/month counter |
| requests → current attempt | optional `(id, current_attempt_number)` | 0..1 current attempt per request | Finalizing a different request's fence |
| teams/users/memberships → audit actors | nullable team/user and membership/team/user signature | Each parent can have many events | Cross-team actor attribution; system/anonymous shape checked |
| audit → generic target | `target_type`, `target_id`, no FK | Logical reference only | No ownership/access inference; survives target deletion |

All remaining `team_id` columns directly reference `teams.id` as well as the composite target FKs. Actor/uploader membership FKs preserve history, never imply the actor still has authority. Diagram source omits some repeated actor edges for readability; this ledger remains normative.

## 5. Index plan

PK/unique constraints create their required B-tree indexes. PostgreSQL does not automatically add every useful child-FK lookup index; explicitly add:

- Membership lookup `(user_id, team_id) WHERE removed_at IS NULL`; admin invariant `(team_id, role) WHERE removed_at IS NULL`.
- Documents `(team_id, created_at, id) WHERE deleted_at IS NULL`; restricted-grant probe `(grantee_membership_id, document_id) WHERE revoked_at IS NULL`.
- Versions `(document_id, version_number DESC)`; chunks `(team_id, version_id, chunk_ordinal)`; version/profile signature indexes as required by FKs.
- Storage recovery `(state, lease_expires_at, updated_at)`; job recovery `(state, next_attempt_at, lease_expires_at)`; pending outbox `(available_at, id) WHERE state = 'pending'`.
- Conversations `(owner_membership_id, created_at, id) WHERE deleted_at IS NULL`; messages `(conversation_id, created_at, id)` and assistant owner/team lookups needed by policy helpers.
- Sources `(document_id, message_id)` and `(version_id, message_id)` for invalidation, plus chunk FK lookup; message-first uniqueness supports the all-provenance anti-join.
- Feedback uniqueness and message FK lookup; quota active attempts `(lease_expires_at, id) WHERE state = 'held'`; request key uniqueness and attempt period/state lookup for reconciliation.
- Audit `(team_id, occurred_at DESC, id)` and `(target_type, target_id, occurred_at)` for filtered access/retention.

Start with exact cosine-distance ranking **inside the authorized eligible set** and a matching profile/dimension predicate. Do not add an approximate vector index until the small fixture works correctly and an explain/recall exercise justifies it. Indexes improve speed, not access rights. Evaluate large all-source checks and source invalidation plans before increasing data sizes.

## 6. Authorization predicates and response behavior

`active_member(user, team)` resolves the current membership after verified identity. `can_read_document(member, document)` requires: same team; active membership; document not deleted; visibility team OR an unrevoked grant to that exact membership. There is **no admin OR clause**.

`can_read_assistant_message(member, message)` requires: active exact owner membership; live own conversation; no permanent invalidation; and **no potential source** with missing/purged version/chunk, deleted document, or failed current `can_read_document`. A grounded answer requires at least one source and one validated displayed citation before completion. Source-free fixed insufficient replies are allowed; if a provider saw chunks before producing a fixed insufficient result, those chunks still receive provenance. Only content-bound command functions may finalize this invariant.

Retrieval additionally requires a ready version equal to `documents.current_version_id` and the compatible deployment embedding profile. Historical citations require the original retained ready version, not current-pointer equality. Document/version/download endpoints require current content read. Update/delete also require editor/admin role. Member/ACL/budget commands require current admin role; blind ACL commands follow D08's neutral contract.

Lists, joins, counts, pagination, source labels, exports, feedback, and retries must use these predicates, not check only the first route. No protected shared/CDN caching; use private/no-store responses. Recheck cached-completed request results as history reads. Use neutral 404-style responses for ordinary inaccessible/missing targets, 403 for a known team-level role denial, and a fixed unavailable marker for an owned answer whose source access was lost. Never distinguish a hidden document by title or existence in errors.

## 7. Database roles and RLS plan

| Role | Powers | RLS / trust boundary |
| --- | --- | --- |
| `app_owner` (NOLOGIN) | Own schema/tables; migration-time DDL | `NOBYPASSRLS`; FORCE on app tables; ownership can still alter/disable protections |
| `app_migrator` (separate credential) | Explicitly assume owner for versioned DDL/seed | Privileged setup only, never runtime connection |
| `app_api` | Narrow SELECT under RLS; execute allowlisted API commands | Non-owner, NOBYPASSRLS; no arbitrary DML/TRUNCATE/DDL or role assumption |
| `app_worker` | Job/outbox/intents reads and allowlisted processing/recovery commands | Non-owner, NOBYPASSRLS; service policies intentionally allow trusted job work across teams, no general chat browsing |
| `app_commands` (NOLOGIN) | Own constrained SECURITY DEFINER command functions, narrow DML grants | Not table owner; team-scoped service policies plus explicit action/identity/fence checks |
| `app_policy_reader` (NOLOGIN) | Narrow read of membership/ACL/provenance metadata for boolean helpers | Non-owner; nonrecursive role-specific policies; no document text/body/object-key read |

Enable/force RLS on all application tables, including joins, staging chunks, quota rows, and audit. Runtime SELECT policies call narrow helpers for current membership/document/message access. Column grants/views hide operational/internal metadata such as object keys and helper-only provenance. Helper role has enough metadata to calculate all-source access without recursively querying message RLS; no full body privilege. API never exposes raw database rows.

Use schema-qualified names, fixed safe `search_path`, parameterized statements, `row_security = on`, revoked PUBLIC function execution/schema creation, and separate connection pools/credentials. Protect teamless global tables with minimal self-profile/profile-config/system policies. API sees only its own active membership/profile information unless a permitted roster command projects more. Team admins receive allowlisted audit/budget aggregates; not individual private answers. Workers can invalidate messages through commands but cannot select answer text.

The API establishes `SET LOCAL` user/team/membership/request context inside a transaction after token verification and a database lookup. Never take it from client headers/body IDs. Transaction-local context must reset on pool reuse. These settings are not unforgeable if an attacker obtains SQL execution under the runtime role. Trusted commands/credentials remain a security boundary. Supabase public `anon`/`authenticated` roles get no app-schema direct table/function grants. No owner/service-role DB connection is substituted for the API role when an RLS test is inconvenient.

Storage has separate policies on `storage.objects`: deny all ordinary-user operations for the private bucket; backend service credential only. A local PostgreSQL test cannot establish that the configured remote bucket policies are correct.

## 8. Transactions and lock ordering

Use short explicit `READ COMMITTED` transactions with bounded lock timeouts and safe retries for deadlock/serialization failures. The first statement acquires the team gate; permission/source checks are **subsequent fresh statements**, not a snapshot taken before waiting on that lock. `clock_timestamp()` or an equivalently current database wall clock is used for lease validity after waits; transaction-start time is insufficient for an expired lease.

Global ordering: team UUIDs sorted if more than one is required → budget → period start/id sorted → request → attempt → conversation → document IDs sorted → version/job/intent IDs sorted → messages. A particular operation may skip unused categories but must never acquire them in reverse order. Reconciliation discovers a candidate without locks, then reacquires from the team gate and rechecks. Chunk staging is separate from provider calls. Cross-team copy is implemented as a fresh read plus re-upload, not a hidden two-team transfer transaction.

| Operation | Gate and atomic work | External calls |
| --- | --- | --- |
| Create team | Insert team, budget, first admin, system audit together | None |
| Change membership/role/grant/visibility | Team FOR UPDATE; fresh admin check; last-admin/active-grantee check; mutate; revoke removed membership grants; increment epoch; audit | None |
| Upload phase A | Team FOR SHARE; current upload/read check; allocate intent/lease/key | Upload original after commit, bounded size/time |
| Upload phase B | Team FOR UPDATE; recheck current role/read/document; fence/attach intent; allocate version sequence; create version/job/outbox; uploader grant for new doc; audit | No Storage/Redis call inside transaction |
| Worker claim/stage | Team gate then job/intent/version; claim/increment fence or conditionally insert complete staging chunks; reject deleted document/stale token | Extract and embed outside transaction |
| Version activation | Team FOR UPDATE; current lease/fence; validate complete chunks/profile/document; compare version numbers; set ready/pointer if eligible; audit | None |
| Delete | Team FOR UPDATE; read + editor/admin; tombstone/null pointer; permanently invalidate every dependent assistant message; enqueue purge; epoch; audit | Object purge later |
| Purge | Team gate; verify tombstone/fence; verify dependent answers invalidated; clear source chunk pointers before deleting chunks | Object deletes outside transaction; per-object state permits retry |
| Retrieve/history/download authorization | Team FOR SHARE; fresh owner/member/document checks; authorized projection | Provider call/download begins after commit; explicit network window |
| Reserve/retry/release/expire quota | Team FOR UPDATE; current member; budget/period/request/attempt locks; update ledger+counters once | Never generate inside lock |
| Final chat save | Team FOR UPDATE; budget/period/request/attempt then conversation/doc locks as needed; fresh all-source and owner checks; current live fence; save answer + every potential source + charge/release; commit | HTTP response only after commit |

All writers, including management commands and maintenance, participate in the gate. Direct runtime DML is prohibited precisely because a forgotten writer would break this ordering. Large chunk/object purge batches are bounded and restartable; they do not hold the gate over network calls.

### Final authorization timeline

1. Retrieval reads allowed chunks under a shared gate and materializes no hidden result.
2. A short pre-dispatch transaction rechecks the exact context set before sending it to the model.
3. Model work runs without database locks. Revocation/deletion can commit during it.
4. Final transaction obtains the gate and rechecks current membership, every supplied document/version/chunk, owner conversation, and the current unexpired quota fence. Under the proposed conservative freshness rule, supplied versions must still be current-ready; a version change is retryable without charging, while a completed historical answer remains tied to its original version.
5. On access loss: discard generated content, save no sensitive assistant result, release the hold, and return a neutral unavailable result. On success: save provenance/answer/settlement atomically.
6. Successful final commit is the authorization linearization point. A revocation that committed first must be observed; a writer waiting behind this transaction is ordered afterward.
7. Network delivery occurs later. No claim is made that authorization remains unchanged during packets, that prior provider context can be recalled, or that delivered text/downloads/screenshots can be withdrawn.

### Quota state transitions

New request → held attempt (`held_count + 1`) → either grounded completion (`held_count - 1`, `used_count + 1`, request completed), or uncharged insufficient completion (`held_count - 1`, request completed), or failure/revocation/expiry (`held_count - 1`, request retryable/blocked as appropriate). Terminal transition matches the current attempt and occurs only once. A retry after release creates the next attempt number; the expired old number can never complete. No evidence/user response from a stale provider call is accepted.

At the final available slot, separate transactions both acquire the team gate; the first conditional reservation wins and the second observes no capacity. Month rollover uses the attempt's stored period. Current limit decreases preserve existing holds. Completed-key replay never reserves, calls a model, or increments usage, even when its answer is now unavailable. Recovery and completion race through the same ordered locks and wall-clock lease predicate.

## 9. Lifecycle and retention

- Membership removal is a terminal historical row, never physical deletion for normal operations. It immediately prevents all requests/old-chat ownership. Rejoin has new IDs/grants/conversations.
- Logical document deletion is synchronous. Original objects and extracted chunks purge asynchronously. Preserve opaque document/version and provenance tombstones; do not erase source links before invalidating dependent messages. Restore/undelete is unsupported.
- Old ready revisions remain until whole-document deletion; only current-ready chunks are retrievable. Historical citation downloads must check the current grant and original retained version.
- Owner conversation deletion removes messages/sources/feedback content in a controlled transaction, keeps an opaque conversation tombstone and minimal completed idempotency records, and never refunds successful usage. Admins cannot invoke owner deletion for private browsing.
- Audit target references are intentionally nonrelational and survive deleted targets. Proposed 365-day retention requires a dedicated maintenance role/path; ordinary API/worker users cannot mutate logs.
- No automatic account/team/organization deletion or full privacy-erasure workflow is part of the MVP. Minimal tombstones/request keys currently have no automatic expiry. Backups and provider-held data require separate operator policies.
- Outbox/job/intents can be compacted only after terminal work and sufficient non-content failure evidence is retained; exact operational windows are deferred to the implementing modules and must not be advertised before verification.

## 10. TechCo walkthrough

Sara's HR membership is editor; her separate Engineering membership is viewer. Leave Policy is visible to her through HR membership; Salary Plan is absent from her list, counts, retrieval, and citations because it is restricted to Hina. Hina's explicit grant, not her admin role, authorizes Salary Plan content. Sara can read API Guide as an Engineering viewer but cannot upload there. Ahmed cannot read either HR document because no HR membership exists.

If Hina grants Sara's HR membership Salary Plan read access, Sara can ask a grounded question in her own HR conversation. If that grant is revoked before final answer authorization, the generated answer is discarded without charging. If revoked after a successful answer, future history reads hide the entire affected answer, including uncited potential sources and previews. If Sara leaves/rejoins HR, a new membership cannot inherit that grant or conversation. None of these examples imply any rows, services, or protections have been implemented in Module 0.
