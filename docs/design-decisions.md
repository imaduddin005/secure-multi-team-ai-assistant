# Design decisions and open adoption

Initial design date: 2026-11-18. Module 1 was authorized by the learner on 2026-11-19. Proposed business decisions remain awaiting explicit learner adoption; the database uses the documented working blueprint without attributing its engineering reasoning to the learner. `Required` records the user's explicit assignment; `Proposed` records a recommendation awaiting review. Execution/verification is tracked separately in module progress.

## D01 — Module and authorship boundary — Required

The initial authorization was Module 0 only, with no apps/migrations/provisioning/deployment. On 2026-11-19 the learner first authorized Module 1 database implementation, then explicitly authorized completing all remaining modules without separate next-module confirmations; see `module-progress.md`. The earlier per-module boundary is historical. Explain in Roman Urdu; technical artifacts remain English. Record actual learner acceptance or revisions separately; do not represent AI-generated analysis as the learner's independent work. Implementation authorization is not adoption of every proposed product decision.

## D02 — Required stack and component responsibilities — Required

Node.js is the JavaScript runtime used to execute the backend. NestJS is the backend framework running on it. Next.js is the frontend web framework and can also run server-side web work; it does not replace the NestJS authorization service. TypeScript adds checked types; it does not validate untrusted runtime input by itself. Tailwind styles the UI.

PostgreSQL stores structured records and enforces relationships/transactions. pgvector supplies vector storage and similarity operators. Private Storage stores original file bytes, not the relational truth about access. Supabase Auth verifies account identity; the app checks present team membership and document permissions. Authentication answers who someone is; authorization answers what they may do now.

BullMQ/Redis delivers work tickets. A worker is a separate process that consumes those tickets, extracts text, creates chunks, calls the embedding adapter, and attempts activation. A chunk is a small location-aware portion of a document. An embedding is a numeric representation for similarity search, not a permission. Retrieval selects eligible authorized chunks; generation produces an answer from that allowed evidence.

## D03 — Database topology and SQL approach — Proposed

Use one canonical application PostgreSQL database, preferably the selected Supabase project's PostgreSQL for the configured demo. Use isolated local PostgreSQL/pgvector databases for integration tests and Redis through Compose where available. Supabase Auth/Storage remain real services for live acceptance; standalone database tests do not prove those integrations.

Use SQL-first versioned migrations and a thin driver (`pg` proposed), rather than hiding row locks/composite constraints behind an ORM. Alternative: Prisma/TypeORM with explicit SQL migrations and raw locking queries. SQL-first is easier to inspect for this database-heavy assignment but needs careful mapping and parameterized queries. Pin supported image/package versions when coding begins; the Docker client being installed does not prove its engine is usable.

## D04 — Organization and identity scope — Required + Proposed

Required: one organization with multiple teams and per-team membership roles. Proposed: retain `organizations` rather than hard-code TechCo. `users` are application profiles keyed separately from the external verified Auth subject; the subject is unique. There is no password column or global team role. An external identity is deliberately not a cross-service foreign key. Safe fixtures can use clearly non-live subject IDs; real login requires explicit mapping to actual provisioned Auth UUIDs. No organization-wide admin role or invitation workflow is inferred.

## D05 — Membership lifetime and last admin — Required

Keep removed membership rows with `removed_at`; rejoin inserts a new membership ID. Only one active `(team_id, user_id)` is allowed. Grants and conversations reference that membership ID, so a rejoining user cannot revive old grants or private chats. A role change updates the active membership, so demotion is effective on the next protected check. All membership/role changes serialize on the team row and cannot remove/demote its last active admin. Initial team creation and initial admin creation must be one transaction. Removing a final admin through account provisioning or maintenance must follow the same rule.

## D06 — Role matrix and content management — Required + Proposed

| Action | Viewer | Editor | Admin |
| --- | --- | --- | --- |
| Read authorized documents, ask, own-team private history/feedback | yes | yes | yes |
| Upload into own active team | no | yes | yes |
| Revise/delete a currently readable document | no | yes, proposed scope below | yes, with read permission |
| Manage members, roles, visibility, explicit grants, budgets | no | no | yes, audited |
| Read a restricted document without a grant | no | no | no |
| Read another membership's private conversation | no | no | no |
| Read permitted team usage/audit projections | no | no | yes |

Proposed: editors may revise/delete **any document in their team that they can currently read**. The uploader is attribution, not an extra ownership ACL. Alternative: only the uploader and readable admins may manage content. The broader editor rule is simpler and fits shared team editing, but permits Sara to delete Leave Policy; the learner should deliberately adopt or change it. Admin ACL authority is separate from content-management authority. Admin may explicitly grant themselves read access; this is a powerful, attributable access change, never an implicit consequence of role.

## D07 — Read grants and visibility transitions — Required + Proposed

Required: a live team-visible document requires active team membership; a restricted document additionally requires an unrevoked grant to the current membership. New uploads default to restricted and atomically grant the uploader read access. All grants are same-team.

Proposed: on a visibility change, revoke prior explicit grants. Switching to restricted requires an explicit replacement reader list, which can deliberately be empty; never silently restore an old ACL. Switching to team uses active membership instead. Removing/rejoining cannot revive grants. Granting a removed membership is rejected by the command path even though its historical row remains a valid FK target. Alternative: preserve grants through visibility changes, which is less surprising operationally but risks unexpected revival.

## D08 — Administrative metadata without enumeration — Proposed

Ordinary/admin document lists, counts, search, filenames, version status, and ACL-reader lists include only documents the caller can currently read. An admin can submit a blind ACL/visibility command for a **previously supplied opaque document UUID**, e.g. received from its uploader. That route returns the same neutral acknowledgement for missing, wrong-team, and unreadable targets after validating the caller's team-admin role and request shape. It returns no title, existence flag, matched count, current ACL, or processing detail. A self-grant can make a subsequent normal read succeed because the admin then has an explicit grant.

This avoids creating an admin list of all restricted documents. Document audit entries are omitted unless their target is currently readable; filter before counts/pagination. Private-chat targets never enter team-admin audit output. Opaque IDs are not authorization. Alternatives: require content-read for all ACL changes (less useful admin recovery), or add a separate metadata permission (would require relaxing the assignment's strict no-hint rule). Blind commands reduce feedback; acceptance tests must cover response shape and obvious timing/count leaks. They cannot promise constant-time behavior across an entire network.

## D09 — Original-file access — Required + Proposed

Required: private bucket, server-side authorization, and direct Storage policy tests. Proposed: ordinary Supabase `anon`/`authenticated` roles have no direct insert/select/update/delete access to this bucket, even with a known object path. All uploads/downloads pass through NestJS; only trusted backend storage credentials operate on objects. Namespace objects with random IDs, never client paths or document titles. Sanitize download filenames and use attachment disposition.

Use backend-authenticated downloads with a current check immediately before returning bytes. Do not issue signed object URLs in the MVP: a bearer URL can remain usable until expiry after a grant is removed. Streaming file bytes cannot be recalled after authorization/delivery starts. Storage service credentials bypass its RLS; storage isolation therefore still depends on trusted API/worker code and secret handling. A private bucket by itself is insufficient. [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control).

## D10 — Upload validation and failure recovery — Required + Proposed

Support UTF-8 TXT and text-based PDF, at most 20 MiB = 20,971,520 bytes (proposed precise interpretation of “20 MB”). Validate both streamed byte count and actual format; names/extensions/declared MIME are not proof. Reject malformed UTF-8, encrypted/unreadable PDFs, image-only/scanned PDFs without usable text, and unsupported types; no OCR. A partly scanned PDF must fail eligibility unless every content-bearing page is extractable; define parser-specific detection and explain its limits in Module 4. Bound parser CPU/time/pages/text/chunk count before embedding. Malware scanning is a production improvement, not a claimed MVP feature.

Persist a storage intent with its random object key **before** uploading, using upsert disabled. After upload, create/attach document/version, job, and outbox atomically, rechecking role/read authority. The intent ledger permits cleanup after upload-success/database-failure and process crashes. A reconciler verifies overdue intents and deletes only known unreferenced objects after a grace/lease check. If storage is unavailable, cleanup remains pending with retries. No transaction spans PostgreSQL, Storage, and Redis. Bucket inventory reconciliation is still needed for manual/bypass uploads or lost database backups; do not claim all possible orphan bytes disappear immediately.

A timed-out Storage PUT may still finish after cleanup's first delete. A database fence cannot cancel that external write. Reconciliation must therefore recheck unreferenced intent keys, including recently purged intents, after the bounded upload window/grace and retry any late object's removal. Periodic bucket inventory is the fallback after intent compaction. Eventual cleanup depends on these repeated checks and healthy Storage; no claim of atomic upload/cancellation or zero orphan interval is made.

## D11 — Immutable revisions and activation ordering — Required + Proposed

Each document has immutable content revisions, a per-document sequence, and a nullable current-ready pointer. Allocate sequence numbers under a document lock. A version's file, hash, profile, and extracted content do not change after creation/processing; status and job telemetry may change. Retry work by replacing incomplete staging chunks under a fresh job fence, never by creating a new revision.

Proposed ordering: **the highest successfully ready revision wins**. Activation can only increase the current revision number. If v3 finishes before v2, v2 cannot replace v3. If v3 fails and v2 is ready, v2 may become/stay current. The previous current version remains available while a replacement is queued/processing/failed. Alternative: latest-submitted-only activation, which can suppress a successful v2 even while v3 fails. Retrieval always follows the current-ready pointer, never “all chunks in this team.”

## D12 — Jobs, outbox, and embeddings — Required + Proposed

PostgreSQL holds durable job intent; Redis is delivery infrastructure. Publish using an outbox, use the durable job UUID as queue identity, and reconcile nonterminal database jobs even if a previous publication was marked sent. Claim jobs with a database lease and monotonically increasing fencing token. All staging writes and activation verify that token and the live document; bounded retries then fail visibly. A repeated/completed job is a no-op. Unique `(version_id, chunk_ordinal)` prevents duplicate chunks. These are proposed app guarantees, not “exactly once” queue claims. [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), [bounded retries](https://docs.bullmq.io/guide/retrying-failing-jobs).

Use an immutable `embedding_profiles` record to pin provider/model/dimensions/chunker version. No default provider or model has been selected. Initially permit one deployment retrieval profile and exact vector ranking over eligible rows. A configuration change cannot silently mix embedding spaces: re-index/migration or an explicit compatible profile rollout is required. HNSW/IVFFlat are optional later optimizations; approximate-index filtering/recall needs separate evaluation and never replaces the authorization predicate. [pgvector project documentation](https://github.com/pgvector/pgvector).

## D13 — Delete, move, and version retention — Required + Proposed

Delete transaction: lock the team gate; set `documents.deleted_at`; make the current pointer ineligible; permanently invalidate all assistant messages whose provenance references this document; enqueue durable purge work; append audit; commit. All reads reject tombstones immediately. Purging later clears source chunk references only after answer invalidation, then removes chunks/originals with retries. Keep minimal document/version/source tombstones; a stale worker cannot reactivate them.

No cross-team reassignment of a document or membership. A controlled copy/re-upload is a new destination document after source-read and destination-upload checks. There is no atomic move or shared source lifecycle. Proposed MVP retains old ready versions until document deletion, supporting historical citations; independent version expiry is not implemented/planned as a UI feature. If later added, invalidate dependent answers before purging.

## D14 — Fresh chat context and source validation — Required + Proposed

Use non-streamed responses. Retrieve only currently readable, non-deleted, current-ready chunks; perform a pre-dispatch check on the full source set. Send a source-labelled data section separated from system rules and the user's question. No unrestricted database, storage, shell, browsing, or network tools are given to the answer model. Require structured source references and reject any reference not present in the supplied set; render escaped/sanitized output.

Record **every chunk supplied to the model** as potential provenance; displayed citations are a flag on that full set. Verify citation labels and locations deterministically. Groundedness/entailment is partly a model-quality question and needs real-model evaluation; a valid source ID alone does not prove a sentence is true. No evidence produces a fixed, clear insufficient-sources response. No earlier generated answer is reused as factual evidence; proposed MVP is single-question retrieval even inside a conversation, without prior assistant text in model inputs. Prompt-injection defenses reduce risk without proving immunity.

## D15 — Private history and old citations — Required + Proposed

Conversation ownership is the originating membership, not just the global user or admin role. Removed memberships and rejoining users cannot access that old membership's chats. Every assistant read/replay/feedback/citation route checks **all** stored potential sources. If even one is no longer readable, omit the entire answer body, citation list, source title/location, snippets, and derived conversation preview; return a neutral unavailable marker. Do not expose hidden counts through search/preview exports. Conversation titles are generic/user-supplied in the MVP, never generated from a hidden answer. User-authored questions may remain visible to their owner.

Proposed: permission-based unavailability is dynamic and may clear if the same still-active owner membership later regains access. Deletion/purge invalidation is permanent. Old-version citations remain bound to the original immutable version, are labelled historical, and require current document-read access plus retained original sources. They never silently retarget to the new text. Alternative: permanently invalidate on every grant loss, which is more conservative but cannot restore history after legitimate regrant.

## D16 — Authorization ordering and unavoidable delivery window — Required + Proposed

Use the team row as a short transaction gate. Final protected pure reads take `FOR SHARE`. Every membership/role/ACL/visibility/deletion change takes `FOR UPDATE` on the same row. Final chat commit takes `FOR UPDATE` because it also settles quota. After acquiring the gate in `READ COMMITTED`, run fresh membership/source checks in subsequent statements, then save answer/provenance/settlement atomically. **The successful final transaction commit is the answer's authorization linearization point.** A revocation committed before that check must block the answer; a revocation waiting behind the held gate is ordered after it. Proposed conservative freshness rule: each supplied version must also still be the current ready version at final commit; a newly activated revision causes a neutral retryable rejection without charging, rather than silently returning stale content. Previously completed answers retain historical citation semantics.

Never hold locks over AI or Storage network calls. Retrieval and pre-dispatch authorization precede the model request; final authorization precedes user delivery. There are database-to-network windows after both checks: permissions can change while a provider call or HTTP delivery is in flight. Final recheck prevents delivery when revocation committed before final authorization. It cannot recall previously sent provider context, delivered text, downloaded bytes, screenshots, or saved files, nor promise that permission still exists at every network packet. This is the explicit security ordering, not a wall-clock recall guarantee. [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html).

## D17 — Database roles, RLS, and trusted components — Required + Proposed

Separate table owner/migrator, API runtime, worker runtime, and internal command/policy-helper roles. API/worker roles are non-owner and `NOBYPASSRLS`; enable and force RLS on application tables. Restrict direct writes; allowlisted commands enforce locks and multirow invariants. A narrow non-login helper can read membership/ACL metadata to avoid recursive policies; functions have fixed search paths, schema-qualified identifiers, no arbitrary SQL, and no public execution grant. Exact grants/policies must be proven in Module 1.

The backend sets transaction-local user/team/membership context only after verified identity and membership lookup. That context is trusted backend input, not cryptographic identity inside PostgreSQL; compromised database credentials or SQL injection could spoof it. RLS does not rescue bypass credentials, a compromised privileged command, the owner, a superuser, or a broad trusted worker. No app tables are exposed directly through public Supabase Data API schemas/grants. [PostgreSQL RLS and owner/bypass behavior](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

For asymmetric Supabase signing keys, use the project's trusted JWKS and a supported verifier with an algorithm allowlist, expected issuer/audience, expiration/not-before validation, and key-rotation handling. Decoding alone is not verification. Legacy symmetric-token deployments need a supported server verification flow such as Auth `getUser`, rather than accepting unverifiable tokens or reusing a public key as a secret. Exact library/flow and session-revocation limits are Module 2 work. [Supabase JWT verification guidance](https://supabase.com/docs/guides/auth/jwts).

## D18 — Quota unit, UTC periods, and limits — Required + Proposed

Required starting limit: 1,000 successful saved answers per team per UTC calendar month. Proposed charge unit: one committed, source-grounded assistant answer; no-sources/insufficient, provider failures, invalid citations, and revoked/blocked attempts do not consume an answer slot. A fixed insufficient reply may be saved as a completed uncharged response. Deleting/hiding a previously successful answer does not refund its historical charge. This interpretation needs learner adoption.

Pin each attempt to the UTC month when it reserves. A successful answer completing after midnight charges that reservation month; a fresh attempt after expiry uses its new reservation month. Old completed idempotent replays never move months. Alternatives: charge completion month, which requires an extra atomic transfer/rejection step at month rollover; or charge all saved replies including insufficient ones. Use database time. Limit changes apply immediately to new reservations, preserve existing holds/charges, and may lower the limit below already committed usage. No further slots are issued until capacity exists.

## D19 — Reservations, idempotency, fencing, and provider cost — Required + Proposed

Persist a logical `usage_reservations` request with unique `(team_id, owner_membership_id, idempotency_key)` and a request fingerprint. Persist separate `usage_attempts` for every lease/fence attempt. A completed request returns its original result only after current history authorization; changed payload with the same key is a conflict. An in-progress duplicate cannot invoke the provider again. A released/expired retry receives a new attempt number/fence; old attempts cannot save/charge after supersession.

Serialize brief team quota operations at the team gate and lock the budget/period/request/attempt rows. Reserve increments held count only if `used + held < current_limit`. Completion moves held → used in the same transaction as message/provenance creation. Failure/expiry releases exactly once. A reaper and completion use the same locks/fence/lease predicates. No locks are held during provider work. Completed request-key tombstones remain even after chat deletion; replay of purged content returns unavailable rather than generating again.

Fencing prevents duplicate accepted answers/charges; it cannot cancel an already running external request after lease loss or guarantee exactly one provider bill across crashes/timeouts/retries. Limit retries, bound provider timeouts, and renew leases while the current attempt is alive. Provider token/cost accounting is **not an MVP billing guarantee** and is not implemented; product answer quotas are independent from paid provider usage.

## D20 — Feedback and audit — Required + Proposed

Feedback is one current helpful/unhelpful rating, optional bounded comment, per user/message. Since only the owner membership can access that private answer, a unique message/membership pair plus enforced owner identity realizes the per-user rule. Recheck all provenance on both create/update and feedback reads.

Audit changes in the same transaction that commits the action. Store actor kind/user/membership when applicable, team, allowlisted action, generic target type/UUID, database timestamp, request/correlation ID, and a small non-content detail allowlist. System workers have explicit actor names. Generic target IDs intentionally have no FK so evidence survives target deletion; they do not grant access. No titles, original filenames, questions, answers, source text, feedback comments, secrets, or raw provider errors in audit. Ordinary runtime roles cannot update/delete it. Owners and dedicated retention operators retain broader powers; this is not cryptographic tamper-proof logging.

## D21 — Retention and operational limits — Proposed

Propose 365-day audit retention under a dedicated maintenance procedure in Module 7; it is an educational product choice, not a legal compliance claim. Retain minimal identity/membership/document/version tombstones and completed request-key records in the MVP. Retain live chats until owner deletion; no automatic conversation-age retention feature. Deletion immediately disables app access and queues file/chunk removal, but completion depends on running workers and healthy services; do not promise an unverified time SLA. Provider retention, infrastructure backups, disaster recovery, antivirus, full privacy erasure, high availability, and scalable approximate search remain production work.

## D22 — Verification and demonstration — Required

Use genuine PostgreSQL connections and controlled barriers for authorization/concurrency, deterministic test-only AI/storage for repeatable failure paths, and separately labelled real-service/model acceptance. Never equate a mocked token with real login or mocked object operations with Storage policy enforcement. Provision demo Auth accounts and files separately from SQL fixtures. Generate final PDF/Word/report/source package only in Module 9. Module 0 performs document consistency and diagram rendering checks only.

## Learner adoption record

| Decision group | Learner decision | Evidence |
| --- | --- | --- |
| Required assignment rules | Supplied by learner | Original pasted request, 2026-11-18 |
| Proposed choices D03–D21 | Pending review; no acceptance inferred | Module 0 only |

Most consequential review points: readable-editor management scope (D06), blind admin ACL behavior (D08), highest-ready revision ordering (D11), dynamic history reappearance (D15), quota charge/month semantics (D18), and retention (D21). Questions or proposed corrections remain within the currently authorized module.

## Module 1 implementation refinements

- SQL-first migrations and the `pg` driver were selected as the engineering baseline for the authorized database module. Business APIs remain unimplemented.
- Added `app_meta.schema_migrations` outside the 21 business tables for checksums/applied versions.
- Added message `expected_source_count`/`finalized_at` to prevent incomplete or subsequently rewritten stored provenance; external provider-context completeness still needs orchestration tests in Module 6.
- Added `document_grants.revoked_by_system` for automatic removal attribution, rather than inventing a human actor.
- Extended chunk source FKs with `chunk_ordinal` and validated source locations; made terminal usage attempts fully immutable.
- Selected separate local demo/test PostgreSQL services and positive cluster-name checks before provisioning/reset. No credentials or live-service verification are inferred from this choice.
- Runtime database writes are denied until later modules introduce constrained, action-authorized commands. API/worker roles are not owners; owner/internal command policies remain intentionally powerful and documented.
