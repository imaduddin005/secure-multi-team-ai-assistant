# Requirements and traceability

This is the Module 0 requirements baseline, retained for traceability. Current implementation/execution status is in `docs/module-progress.md` and `docs/verification-evidence.md`. `M` means required by the assignment. `C` means an implementation choice proposed for review. The learner's 2026-11-19 authorization supersedes W01's per-module stop rule: complete all remaining modules in order with learning handoffs.

## Product and learning contract

| ID | Kind | Requirement | Planned component / evidence | First relevant module |
| --- | --- | --- | --- | --- |
| W01 | M | One authorized module at a time; stop after handoff; questions never advance scope | `AGENTS.md`, module progress, learner review | 0 and every module |
| W02 | M | Explain purpose, TechCo example, database, decisions, code, commands, exercise, limitations in Roman Urdu | Module handoff; English code and technical docs | Every module |
| W03 | M | Preserve existing work; inspect repository/instructions/tools; accurately explain local file access | README and inspection evidence | 0 |
| W04 | M | Design artifacts precede migrations/application code; no fixed table count | These docs, two Mermaid sources, rendered diagrams if possible | 0 |
| W05 | M | Do not deploy/push/publish/contact people; protect secrets and source archives | Configuration template, ignore rules, source-package allowlist in final module | Every module |
| W06 | M | Distinguish implemented, tested, fake, live-service, and unsupported behavior | Progress and hard-case evidence | Every module |
| P01 | M | Multiple teams in one organization; users can have different team roles | Organizations, teams, users, memberships | 1–2 |
| P02 | M | Login and actual verified identity | Supabase Auth; NestJS token guard and profile mapping | 2 |
| P03 | M | Private document upload, processing status, versions, deletion | Document API, Storage, jobs, worker | 3–4 |
| P04 | M | Grounded chat, valid citations, protected history, answer feedback | Retrieval, answer orchestration, provenance, private conversations | 6 |
| P05 | M | Quotas, audits, administrative functions | Usage service, audit append path, admin APIs | Relevant module; completion in 7 |
| P06 | M | Simple real Chat, Documents, Admin screens | Next.js frontend; backend API integration | 8 |

## Required technology and proposed topology

| ID | Kind | Requirement / choice | Planned use |
| --- | --- | --- | --- |
| T01 | M | Next.js + TypeScript + Tailwind | Browser UI; login/session UI; never the authorization boundary |
| T02 | M | NestJS + TypeScript on Node.js | Verified identity, role checks, document/chat/admin orchestration |
| T03 | M | PostgreSQL + pgvector | Canonical relational data, vector retrieval, locks, constraints, RLS |
| T04 | M | Supabase Auth + private Storage | Identity provider and original-file object storage |
| T05 | M | BullMQ + Redis | At-least-once job delivery; independently running worker |
| T06 | M | Configurable embedding and answer providers | Backend-only adapters; deterministic isolated test fakes |
| T07 | M | Jest/Supertest + real PostgreSQL integration tests | API behavior plus real database authorization/concurrency |
| T08 | M | Docker Compose where practical | Disposable PostgreSQL/pgvector and Redis for local work/tests |
| T09 | C | One canonical app database; Supabase PostgreSQL for configured demo, local pgvector DB for isolated tests | No duplicate app data store or database synchronization |
| T10 | C | SQL-first migrations and a thin PostgreSQL driver | Makes composite constraints, RLS, and row locks visible to the learner |

## Security and membership requirements

| ID | Kind | Requirement | Planned control / test |
| --- | --- | --- | --- |
| S01 | M | Never expose unreadable document-derived text, title, metadata, citation, or hint | Authorized SQL retrieval before model context; protected response projection and final recheck; negative cross-team tests |
| S02 | M | UI checks and model prompts are not security boundaries | Server identity/authorization plus database constraints/RLS |
| S03 | M | Roles belong to memberships; one active membership/user/team | Partial unique index and role enum/check |
| S04 | M | Removed membership cannot authorize; rejoin creates new ID; old grants do not revive | Historical memberships; grants reference membership IDs |
| S05 | M | Last active admin cannot be removed/demoted | Team serialization gate and invariant-enforcing command path |
| S06 | M | Viewer asks/reads own team chats/feedback; editor adds authorized upload/manage | Server guards, command checks, direct API tests |
| S07 | M | Admin manages members, ACLs, quota, permitted audit/usage; no implicit restricted read or private-chat access | Separate control-plane authority and content-read predicate |
| S08 | M | Team/restricted visibility; restricted default; uploader initial read grant; same-team grants | Atomic document + grant creation; composite FKs |
| S09 | M | Protect lists, search, versions, download, retrieval, citations, history, feedback, admin routes | Endpoint access checklist, RLS, shared authorization service |
| S10 | M | Neutral denials; prevent administrative/audit enumeration | No hidden rows/counts/labels; uniform blind ACL-command acknowledgements |
| S11 | M | Private originals; test `storage.objects` policies and direct access | No ordinary-user bucket operations; backend-authenticated download |
| S12 | M | Same-team grants/sources/chats; distinguish API/worker/migration roles and bypass privileges | Composite keys, narrow grants, forced RLS, role inspection tests |
| S13 | M | Derive identity from verified token, never request user IDs | Signature/issuer/audience/time checks; server-selected current membership |
| S14 | M | Prompt injection defenses without claiming immunity | Treat source text as data, no tools, source labels, reference validation, safe rendering |
| S15 | M | Apply security as each feature appears | Module 3 cannot ship open storage; Module 6 cannot defer safe history |

## Lifecycle, chat, usage, audit

| ID | Kind | Requirement | Planned component / owner |
| --- | --- | --- | --- |
| L01 | M | UTF-8 TXT and text-based PDF; 20 MB max; reject unsupported/scanned PDFs without OCR | Upload validation (3), extraction/content eligibility (4) |
| L02 | M | Validate → private original → durable intent → extract → location chunks → embeddings → atomic activation | Storage intent + version + job + outbox + worker (3–4) |
| L03 | M | Bounded retries, idempotency, duplicate-safe chunks, failed publication recovery, cleanup | Job leases/fences, unique chunk ordinals, reconciliation, cleanup intent (4) |
| L04 | M | Immutable revisions; failed replacement preserves prior ready version | Locked version allocation and monotone current-version activation (3–4) |
| L05 | M | Deterministic concurrent updates; no older completion replaces newer active content | Larger successfully ready revision wins (4) |
| L06 | M | Delete blocks reads immediately; invalidate answers before provenance/chunk removal; purge retry; no stale restoration | Team gate + tombstone + permanent message invalidation + purge jobs (3–4, 6) |
| L07 | M | No direct cross-team move; controlled copy/re-upload needs source read + destination upload, new ID/grants | Explicit unsupported move route; documented re-upload flow (3) |
| C01 | M | Auth → membership → reserve → authorized retrieve → generate → validate → recheck → save provenance → settle → return | Non-streamed chat orchestrator (6) |
| C02 | M | No invented citations; clear insufficient-sources result | Allowlisted chunk labels and structured provider output validator (6) |
| C03 | M | All model-supplied chunks are provenance, even uncited | `message_sources` contains full potential source set (6) |
| C04 | M | Owner-membership-only histories; hide whole affected answer/metadata when any source inaccessible | Conversation owner FK + anti-join over all provenance (6) |
| C05 | M | Hidden history excluded; no prior generated answer as factual evidence; fresh retrieval | MVP answer input omits previous generated answers (6) |
| C06 | M | Define final authorization ordering and residual network window | Short locked final transaction; two-connection barrier test (6) |
| C07 | M | Explain immutable old-version citations | Authorized original-version reads; explicitly mark historical versions (6) |
| Q01 | M | 1,000 successful saved answers/team/calendar month; UTC; database authoritative | Budget + monthly counters + reservation ledger (5) |
| Q02 | M | Atomic reserve; one final-slot winner; scoped idempotency; no duplicate completed replay charge/generation | Unique request scope, team/period locks, cached accessible result (5–6) |
| Q03 | M | Release failed/blocked; recover expiry; fence retries; reject stale completion | Reservation attempts, leases, guarded settlement/reaper (5) |
| Q04 | M | Quota changes audited; product quota separate from provider cost | Budget command + audit; provider billing explicitly outside MVP (5, 7) |
| F01 | M | Helpful/unhelpful, optional comment; one current rating per user/message; accessible assistant only | Owner-membership message constraint + feedback upsert (6) |
| A01 | M | Membership/role/upload/activation/delete/visibility/grant/quota/security events | Audit appended in each feature's transaction, reviewed in 7 |
| A02 | M | Actor/system actor, team, action, target, time, correlation ID | Append-only audit table and safe output projection |
| A03 | M | No secrets/content; immutable to ordinary users; retention and generic target semantics | Allowlisted details, opaque target ID, dedicated maintenance, no content snapshots |

## Required verification and final artifacts

All required hard cases are mapped individually in `docs/verification-plan.md`: simultaneous uploads; duplicate processing; concurrent revisions; deletion/revocation during generation; final quota slot; cross-team documents/chats/chunks/citations/files; direct Storage access; viewer editor/admin calls; demotion; removal/rejoin; grant revocation; old history; failed replacement; malicious source instructions; fabricated citations; queue/storage failure recovery. Real PostgreSQL and controlled synchronization are mandatory for relational/concurrency claims.

| ID | Kind | Deliverable | Planned module |
| --- | --- | --- | --- |
| D01 | M | Runnable source, migrations, actual setup/run/test README, placeholder env | 1–9 as implemented |
| D02 | M | Safe two-team demo plus separate real Auth/file provisioning | 1 safe rows; 2 Auth; 3 files; 9 acceptance |
| D03 | M | Requirements, decisions, database design, Mermaid ER source/render and architecture | 0, maintained afterward |
| D04 | M | Hard-case execution evidence with expected/actual/command/limitations | Each relevant module; consolidated in 9 |
| D05 | M | Actual short PDF or Word report; explicit missing artifact if conversion blocked | 9 only |
| D06 | M | Source-only submission archive excluding env, credentials, runtime data | 9 only |
| D07 | M | Live final demo: allowed viewer question, denied upload, hidden restricted doc, explicit admin grant, inaccessible old answer, quota | 9 only |

The final report must cover schema/database choice, business rules/reasons, architecture, actual hard-case outcomes, known limits, and production improvements. A frontend build or fake-provider pass will not establish live integration.

## TechCo acceptance fixture

| Person | HR membership | Engineering membership |
| --- | --- | --- |
| Ali | viewer | none |
| Sara | editor | viewer |
| Hina | admin | none |
| Ahmed | none | admin |

| Document | Team | Visibility | Initial authorized readers |
| --- | --- | --- | --- |
| Leave Policy | HR | team | Ali, Sara, Hina through active membership |
| Salary Plan | HR | restricted | Hina through explicit current-membership grant |
| API Guide | Engineering | team | Sara, Ahmed through active membership |

The safe seed now creates these application metadata rows only; real Auth accounts and original files require the separate private provisioning procedure in the README. No demo passwords enter source.
