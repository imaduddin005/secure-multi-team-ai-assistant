# Planned verification and evidence

This document preserves the original verification contracts and identifiers. Some were subsequently implemented and executed; exact runnable test names, actual results and remaining gaps are in `docs/verification-evidence.md`. The identifiers below are contract labels, not literal Jest names. Module 0 checks documentation/diagram consistency only.

## Test layers

- PostgreSQL integration: real migrated database, runtime roles, separate connections/transactions, explicit barriers/locks, and actual commit/rollback. Never SQLite or a mocked repository for isolation claims.
- API integration: Jest/Supertest against NestJS with genuine database commands; real token verification when testing authentication.
- Test-only adapters: named `TestOnly...` and forbidden in production configuration. Deterministic model/storage/queue fault controls isolate orchestration; they do not prove real services.
- Live acceptance: configured Supabase Auth/Storage, worker/Redis, real embedding/answer providers. Model injection/grounding evaluations are behavioral evidence, not deterministic security proofs.

## Hard-case contracts

The rows below describe expected behavior, not current pass claims. Module numbers indicate the first stage where the scenario can be fully tested. Consult the consolidated execution evidence for each implemented branch and unexecuted live/time-boundary case.

| Test identifier | Setup and action | Expected outcome | Layer / module |
| --- | --- | --- | --- |
| `db.same_team_grant_source_and_owner_constraints` | Use raw inserts under a test migration role to combine HR docs, Engineering members/chunks, and another owner's conversation | Composite FK/check failures; no invalid rows committed | Real PG / 1 |
| `db.runtime_roles_and_forced_rls` | Inspect role ownership/BYPASSRLS/grants; use actual API/worker roles for SELECT/DML; try an unauthorized team context | Unreadable content denied; no direct DML/DDL/audit alteration; document explicit trusted-context limitation | Real PG / 1 |
| `auth.verified_identity_only` | Send expired, altered, wrong issuer/audience/algorithm tokens and forged body user IDs; then a real configured Auth token | Invalid tokens rejected; valid verified subject maps only to its own profile | PG + real Auth token / 2 |
| `membership.demotion_effective_immediately` | Sara's HR editor role becomes viewer, commit, then call upload/delete directly | Editor operation denied; viewer's allowed reads remain | Real PG + API / 2–3 |
| `membership.remove_rejoin_new_identity` | Grant current Sara HR membership, remove it, rejoin with a fresh membership, request old grant/chat | Old membership unusable; new membership has no inherited grant/chat | Real PG + API / 2, completed with chat in 6 |
| `membership.concurrent_last_admin` | Create two admins; two separate connections try to remove/demote one each using controlled barriers | At least one active admin remains; exactly valid transitions commit | Real PG / 2 |
| `document.simultaneous_uploads` | Parallel valid uploads by Sara HR with distinct keys and synchronized finalization | Separate docs/versions/intents/jobs; restricted defaults and uploader grants; no overwritten object or lost job | Real PG + storage adapter; live later / 3 |
| `document.viewer_direct_editor_admin_api` | Ali directly invokes upload/update/delete/member/grant/quota routes | Denied by backend irrespective of UI; no mutation or hidden title response | PG + API / 2–3, quota in 5 |
| `document.cross_team_endpoints` | Ahmed supplies HR doc/version IDs; Sara tries Engineering upload as viewer; probe list counts/downloads | No HR title/content/existence leak; upload denied; authorized Engineering reads work | PG + API / 3 |
| `storage.direct_private_access` | With known bucket/object path, try anonymous and ordinary authenticated read/list/write/delete; try signed/public access paths | All ordinary direct access denied; only authorized backend download succeeds | Real configured Supabase Storage / 3 |
| `storage.upload_db_failure_cleanup` | Fail database finalization after a successful object upload; restart reconciler; also release a delayed PUT after the first cleanup delete | Durable pre-upload intent discovers unreferenced object; fenced cleanup retries and rechecks late writes; no app-readable orphan | PG + test-only storage fault/barrier; live later / 3–4 |
| `processing.duplicate_delivery` | Deliver one durable job twice in parallel through two workers, then again after success | At most one accepted fence; unique chunk set; stable current pointer; no duplicate activation charge/event | Real PG + worker + fake embeddings / 4 |
| `processing.concurrent_revision_order` | Allocate v2/v3 in synchronized transactions; finish v3 before v2 | v3 stays current; v2 cannot overwrite; deterministic monotone selection | Real PG + worker / 4 |
| `processing.failed_new_revision_preserves_current` | v1 ready; make v2 extraction/embedding fail beyond bounded retry | v1 remains retrievable; v2 failed; no partial chunks become current | PG + provider fault / 4 |
| `processing.queue_publish_crash_recovery` | Commit version/job/outbox; fail publication or crash after publishing but before acknowledgement; simulate lost Redis job | Reconciler republishes; idempotent worker finishes one logical version; no lost durable intent | Real PG + Redis + fault injection / 4 |
| `processing.stale_or_deleted_job` | Pause worker after provider call; delete doc or expire its lease; resume stale completion | Cannot restore pointer/chunks as current; tombstone remains; bounded purge/recovery completes | Real PG + barriers / 4 |
| `quota.final_slot_one_winner` | Set used+held to limit−1; two connections reserve different request keys | Exactly one held attempt; other sees quota unavailable; nonnegative correct counters | Real PG / 5 |
| `quota.idempotency_fingerprint_and_replay` | Reuse scoped key while active and after completion; send changed payload; use same key in another permitted scope | Active duplicate does not invoke provider; completed replay no generation/charge; changed payload conflict; scopes isolated | PG + deterministic provider spy / 5–6 |
| `quota.expiry_retry_fence_race` | Expire attempt A, synchronize reaper/retry B and late A completion | One release; new fence only may commit; no late answer/charge or negative counters | Real PG + barriers / 5 |
| `quota.utc_rollover_and_limit_change` | Reserve across UTC month boundary using a controlled DB clock abstraction; change limit below usage with held attempts | Attempt charges reservation month; holds honored; new reservations denied; changes audited | Real PG / 5 |
| `chat.revocation_before_final_authorization` | Provider barrier after context accepted; other connection revokes Sara's Salary Plan grant and commits; release provider | Final fresh check blocks all generated text/citations/metadata; hold released; no sensitive assistant saved | Real PG + test-only provider barrier / 6 |
| `chat.deletion_before_final_authorization` | Same barrier with document delete instead of grant revoke | No generated content returned/saved; dependent prior answers permanently invalidated before chunk purge | Real PG + barriers / 6 |
| `chat.final_authorization_orders_before_waiting_revocation` | Hold final gate; another connection attempts revoke; commit answer then allow revoke | Writer ordered after final authorization; later history inaccessible; document residual HTTP delivery window | Real PG + barriers / 6 |
| `chat.current_revision_changes_during_generation` | Supply v1 context, activate v2 before final transaction, then finish provider | Proposed conservative rule rejects/retries instead of returning a newly stale answer; no charge for rejected attempt | Real PG + barriers / 6 |
| `chat.cross_team_retrieval_chunk_citation_history` | Probe HR chunk/message/source IDs as Ahmed and Engineering viewer context as Sara; inspect fake model input | Unauthorized text/title/labels never included in model context or responses; private chats never admin-readable | Real PG + API + provider spy / 6 |
| `chat.all_potential_sources_govern_history` | Supply Leave Policy + Salary Plan but cite only Leave Policy; revoke Salary Plan grant; read answer/preview/citation/feedback/replay | Entire assistant result and sensitive metadata unavailable despite uncited source; no old generated text in later model input | Real PG + deterministic provider / 6 |
| `chat.historical_version_citation` | Answer cites v1; v2 becomes current; request old citation; then revoke/purge | Authorized old v1 text shown as historical while retained; denied after access loss/purge; never retarget to v2 | PG + API / 6 |
| `chat.fabricated_citation` | Fake provider emits a made-up label or another team's chunk ID | Validator rejects result; no unvalidated answer saved/returned; hold released | PG + deterministic fake / 6 |
| `chat.malicious_document_instructions` | Source text tells model to ignore policy/reveal Salary Plan; run fake boundary assertions and separately real model cases | Only authorized context and allowlisted citations; no tool access. Record real model behavior honestly; no immunity claim | Deterministic / real-model evaluation / 6 |
| `feedback.owner_access_and_upsert` | Rate/update own accessible assistant; try another user's answer, user message, or source-revoked answer | One current rating only; forbidden targets denied; comments absent from audit/admin output | Real PG + API / 6 |
| `admin.no_hidden_metadata_enumeration` | Hina without a Salary Plan grant probes admin list/audit counts/ACL reader list and blind commands to real/missing/wrong-team UUIDs | No hidden title/existence/ACL fields; uniform blind acknowledgement; explicit self-grant audited before later content access | PG + API / 3, coverage 7 |
| `audit.atomic_append_and_retention_privilege` | Roll back mutation after audit attempt; try ordinary audit update/delete; execute permitted retention under separate role | Mutation+audit atomic; ordinary tampering denied; retention allowlisted and documented | Real PG / relevant modules + 7 |
| `frontend.protected_state_refresh` | Demote/revoke while each protected screen is open; repeat against live API | Protected responses no-store; UI refreshes and clears stale protected state on next check; no claim to recall screenshots | Real API + browser / 8 |

## Evidence record to complete in each coding module

For each implemented hard case record: test name and file; real/fake/live layer; exact executable command; environment and database version; setup; synchronization point; action; expected result; actual result; exit status; sanitized evidence path; limitations and unexecuted branches. No raw tokens, passwords, file text, real .env, or sensitive fixture contents in evidence.

Planned concurrency tests use explicit provider promises, connection barriers, and database lock observations. Do not use arbitrary sleeps to infer a race. A single process that sequentially calls two mocked repositories is not a two-transaction concurrency test.

Real-service acceptance remains pending until the required infrastructure/credentials are supplied locally. Independent deterministic work should continue within the authorized module when a live service is missing. Never replace real login/storage/AI with an undisclosed mock.
