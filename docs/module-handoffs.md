# Module handoffs

All remaining modules were authorized together on 2026-11-19. This records what each module adds, why, the related data/security rules, one exercise and three points to remember. **Executed commands/results and remaining blockers are authoritative in `verification-evidence.md`; source presence is not a live-service pass.** Roman Urdu learner explanations are in `learner-notes.md`.

## Module 0 - design

Purpose: resolve the product/data/security model before writing migrations. Files: requirements, design decisions, database catalog and Mermaid sources/renders. The 21-table model separates membership identity, original versions, durable processing intent, private chat provenance and accounting. Historical design/render consistency checks are in `module-0-checks.md`.

Exercise: trace why Ali can read Leave Policy but not Salary Plan, including the active membership and explicit-grant predicates.

Remember: roles belong to memberships; admin control does not imply content read; the UI/model cannot authorize a read. Proposed decisions are material for review, not independent learner work.

## Module 1 - database

Purpose: enforce invariants below the API. Files: bootstrap, migrations 001-003, metadata seed, database CLI and `tests/database`. Tables: all 21 and a separate migration ledger. Forced RLS and composite foreign keys prevent cross-team/owner references; immutable identity/state triggers preserve versions and provenance; last-admin changes use real locking. Non-owner API/worker roles differ from team viewer/editor/admin roles.

Actually run: bootstrap/migrate/seed/inspect and the 25-case real-PostgreSQL suite, exit 0, using PostgreSQL 18.4/pgvector 0.8.7 in new project-local clusters. Docker's snapshot-store failure was bypassed without a destructive reset. Auth accounts/files were not created by the seed.

Exercise: run `npm run db:inspect` and explain Sara's two separate rows/roles.

Remember: never use migrator credentials in the API; forced RLS needs verified server context; rejoining uses a new membership ID so old grants/chats do not revive.

## Module 2 - identity and memberships

Purpose: turn a verified external identity into current authorized team actions. Files: `auth.ts`, `database.ts`, `teams.controller.ts`, migration 004. Tables: users, teams, memberships, audit_logs. The verifier checks actual JWT signatures/JWKS/claims, or same-project legacy Auth verification plus expected claims; the backend derives acting identity and ignores JWT admin claims. Every team command resolves current active role under a team gate. Last admin cannot be removed or demoted.

Exercise: demote Sara's HR editor membership to viewer and directly retry upload; Engineering remains its own viewer membership.

Remember: token identity is not a team role; membership changes take effect in server commands; removing a membership is terminal. HTTP checks use real crypto/local JWKS and real PostgreSQL; live Supabase login needs private project setup.

## Module 3 - private documents

Purpose: safe private upload/list/search/versions/download/delete and explicit access changes. Files: document controller, Storage adapter, migration 005 and search hardening in 010, manual private-bucket SQL. Tables: documents, grants, intents, versions, jobs/outbox and audit. Durable intent precedes the remote PUT; finalization rechecks permissions and atomically creates immutable revision/job intent. New documents are restricted with an explicit uploader grant. Download checks access before and after Storage I/O. Hidden/missing administrative targets get the same blind acknowledgement.

Exercise: upload as Sara, verify Ali cannot list it and Hina has no implicit read; Hina explicitly self-grants only when intentionally permitted.

Remember: private bucket plus backend download is essential; restricted is the upload default; role and document read grant are separate. Local tests use synthetic in-memory Storage; manual bucket SQL and `check:storage` require real configuration for a live pass.

## Module 4 - processing and revisions

Purpose: extract/chunk/embed asynchronously without lost intent or stale activation. Files: processing/worker/extraction modules, real provider adapter, migration 006 and recovery hardening 010, Compose Redis. Tables: versions/chunks/profiles, processing_jobs, outbox_events and storage_intents. SQL lease tokens fence duplicate/stale work. The highest successfully ready revision wins. Failed replacement leaves old current content. Tombstone and invalidation precede retriable physical purge. Expired/late unreferenced Storage writes are swept; terminal failed cleanup is not silently retried forever.

Exercise: make a replacement fail and confirm the previous ready version remains current; restore the real provider settings afterward.

Remember: queued is not ready; BullMQ delivers but PostgreSQL records truth; an older or expired worker cannot restore deleted/current content. Real PDF extraction is covered separately from fake embeddings. Actual Redis transport and live provider calls require configured-service acceptance.

## Module 5 - quotas

Purpose: admit and settle answers without overcharging or oversubscription. Files: migration 007, chat orchestration and worker recovery. Tables: usage_budgets, usage_periods, usage_reservations, usage_attempts and messages. Real transactions serialize the last slot; scoped request fingerprints and fenced attempts handle retries. Period identity is recorded at reservation; settlement updates that period. Limit changes are audited and honor existing valid holds.

Exercise: set budget to one remaining answer and send two distinct requests concurrently. Restore the intended budget explicitly.

Remember: held is not used; idempotency keys must stay the same for a retry; provider costs are separate from successful-answer quota. Controlled ledger-period tests do not claim an actual wall-clock month-boundary failure injection.

## Module 6 - answers, history and feedback

Purpose: answer from currently authorized evidence and protect every later read. Files: chat orchestrator/controller, compatible answer adapter and migration 008. Tables: conversations/messages/sources/feedback plus document/usage relationships. Filter before model input, validate source labels, recheck every supplied source/current version at final save, then persist provenance and settle atomically. No old generated answer is factual context. Other memberships, including admins, cannot read the conversation. Any inaccessible potential source hides the entire answer/citations/feedback/replay; historical citations retain the original version.

Exercise: generate from two readable documents, revoke the uncited potential source and refresh the old answer.

Remember: all supplied chunks count as provenance; a valid citation ID does not prove semantic truth; later revocation cannot recall bytes already authorized and delivered. Deterministic test-provider assertions are separate from unexecuted real-model grounding/injection evaluation.

## Module 7 - administration and audit

Purpose: complete safe member/ACL/budget/usage/audit controls. Files: admin controller, migration 009 and operational documentation. Tables: memberships/grants/budgets/audit. Events record action/actor/team/opaque target/time/request ID with allowlisted safe details. Audit output filters unreadable document targets before pagination. Ordinary roles cannot alter audit history; no document bodies, question text, feedback comments or secrets enter audit.

Exercise: compare Hina's permitted audit view before and after an intentional restricted grant; another member's chat remains private.

Remember: administration is not content ownership; mutation and audit commit together; retention requires a separate reviewed operator process. Automatic age-based retention/export tooling is not included.

## Module 8 - frontend

Purpose: provide usable real Login, Chat, Documents and Admin screens. Files: Next app page/styles/layout/config and the public-environment preparation tool. The UI calls real bearer APIs, shows role/status/citations/errors/quota/unavailable states and clears protected panels on logout/team changes. Focus and 15-second refresh recheck permissions; stale scope responses are rejected. Only public Supabase/API settings enter the browser build.

Exercise: log in as Sara, switch HR/Engineering, confirm different upload controls and that HR messages/citations clear immediately on switching.

Remember: server responses decide permission; never expose private keys with NEXT_PUBLIC_; refresh cannot erase screenshots or recalled content. Build/browser checks are recorded separately from real authenticated Supabase acceptance.

## Module 9 - final verification and submission

Purpose: make source reviewable and reproducible. Files: consolidated evidence, README, operations/live acceptance, short PDF report and source-only packaging tool. The archive uses an explicit allowlist and scans included bytes for current private environment values. It excludes real environment files, runtime data, dependencies, compiled output and native copied binaries.

Exercise: inspect the ZIP contents, open the report, then follow the README in a fresh directory with new private configuration. Execute the real acceptance checklist only after services are configured.

Remember: implemented, deterministic-tested and live-verified are distinct; preserve evidence of unexecuted checks; never submit real .env/runtime data. No deployment/push/publication is part of this handoff.
