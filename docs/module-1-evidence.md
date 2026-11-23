# Module 1 execution evidence

Date: 2026-11-19, Asia/Karachi. **Database source/tooling prepared; real PostgreSQL verification remains blocked.** This file separates compiled tooling, test discovery, failed database setup and later unimplemented integrations.

## Environment and scope

Local Windows workspace: `C:\Users\DELL\OneDrive\Documents\secure-multi-team-ai-assistant`. The learner authorized Module 1 with “ok dosa moduele karain”. No HTTP/frontend/worker/provider feature, live Supabase resource, remote push or deployment has been attempted.

Discovered Node 24.12.0, npm 11.6.2, Python 3.12.4, Docker client 29.7.2 and Compose 5.5.1. `psql` is not on PATH; container-provided PostgreSQL tools require a healthy engine. Starting WSL and reporting a Linux kernel does not prove Docker/PostgreSQL readiness.

## Commands actually executed so far

| Command / action | Actual result | Evidence boundary |
| --- | --- | --- |
| Repository/instruction/design inspection | Module 0 files preserved; still no Git worktree | Scope/context only |
| Initial `npm install` | Exit 0; acquired dependencies and lockfile | No database behavior |
| Compatible Jest dependency update | First download timed out; retry with `--fetch-retries=1 --fetch-timeout=120000 --maxsockets=5 --no-fund --no-audit` exited 0 | Interrupted install recovered |
| `npm run build:db` | Exit 0 after fixture parameter annotations were corrected | Compiler accepts database tools and test bodies |
| `npm run db:local:init` | Exit 0; generated root `.env` with random local-only credentials; none printed | No PostgreSQL account created yet |
| `npm audit --json --fetch-retries=0 --fetch-timeout=30000` | Exit 0, zero reported vulnerabilities after adjustment | Dated registry audit only |
| `npm run test:db -- --listTests` | Exit 0; one compiled suite discovered | Discovery, not test execution |
| `docker compose config --quiet` | Exit 0; sandbox warns about Docker user-config access | Compose parses/interpolates without printing secrets |
| Static inventory | 3 migration files; 21 business CREATE TABLE statements; 25 Jest cases | Counts, not SQL validation |
| `docker compose up -d --wait` | Engine startup/ping errors, including HTTP 500 on `dockerDesktopLinuxEngine/_ping` | Image download/container health unverified |
| Scoped Docker startup recovery | Graceful restart timed out; task-started Docker processes/dedicated Docker WSL instance restarted without deleting data | No factory reset/pruning/volume deletion |
| `npm run test:db` | Node process exited out-of-memory during command setup/build | No database assertions accepted as executed |
| Scoped memory diagnostic | 8 GB-class laptop, about 0.9 GB physical / 0.8 GB commit capacity available | Observed resource pressure; not proven sole Docker cause |
| Memory recheck after learner closed apps | About 2.8 GB physical / 5 GB commit capacity available; TypeScript build passed again | Initial resource pressure improved |
| Final `docker compose up -d --wait` | Exit 1: `Docker Desktop is unable to start` | Engine remains unavailable despite memory recovery |
| Final `npm run test:db` retry | Build succeeded; Jest exit 1 with 25 setup failures: `connect ECONNREFUSED 127.0.0.1:55433` | Shared `beforeAll` could not connect; none of the 25 test bodies verified a DB property |
| Local Markdown link/inventory check | Exit 0; no broken links, 21 business tables / 25 test definitions | Source/document consistency only |
| Existing-env preservation/source secret check | Exit 0; initializer preserved existing file byte-for-byte; 8 generated passwords absent from 29 source/doc files | Narrow generated-value scan, not comprehensive secret certification |

The learner reported no visible Docker error and chose to close unused applications. No WSL resource configuration was changed. A later Docker backend error identified its own internal snapshot-store failure:

```text
failed to stat snapshot ... failed to open database file: invalid database
```

This error comes from Docker's internal store, before this project's PostgreSQL migrations execute. The Desktop offered Quit/Reset-to-factory-defaults actions; no factory reset, image/volume pruning, storage deletion, account creation, or PostgreSQL schema mutation was performed. No cleanup command deleted existing Docker data; its integrity/accessibility has not been verified. Recovery that might affect that data requires a separate concrete review/authorization; it is not implied by this database module.

## Integration contracts and expected outcomes

All 25 cases are in `tests/database/boundaries.test.ts`, runnable with `npm run test:db`. They use real `pg` connections; no mocked database. `tests/database/fixtures.ts` contains explicitly test-only text, vectors and relational metadata, with no Auth/Storage/model calls. **Current actual result for every case below: unverified; shared setup failed with ECONNREFUSED before their assertions. Jest reports 25 failed cases, not 25 completed assertion runs.**

| Setup / action | Expected result | Limitation |
| --- | --- | --- |
| Inspect 21 tables and pgvector | Forced RLS and real extension | Actual server required |
| Actual API/worker logins and privileged role assumption | Non-owner/NOBYPASSRLS; SET ROLE denied | Not Supabase login |
| Missing/malformed context and connection reuse | Fail closed; transaction context clears | Trusted test context only |
| TechCo document matrix/admin without grant | Correct readable titles; hidden/missing both absent | No document endpoint |
| Runtime DML/DDL/storage locator/audit append | Permission denied | No HTTP guard test |
| Worker private body/helper source text | Table/column privilege denied | Trusted service roles documented separately |
| Migration/seed replay after data changes | Checksums no-op; changes preserved | Actual SQL transactions required |
| Duplicate membership and last-admin changes | Unique/invariant rejection | Actual commit required |
| Remove/rejoin and old grant | New membership ID; no grant revival | No member-management API |
| Two concurrent final-admin demotions | Observed lock wait; only valid commit; one admin remains | Real separate connections; no sleeps |
| Cross-team/removed-member grant | Composite FK/activity rejection | Real constraints required |
| Restricted document without uploader grant | Commit rejected; valid atomic grant succeeds | Metadata only, no file |
| Cross-team storage intent/duplicate chunk | Composite FK/unique rejection | No real object operation |
| Cross-team chunk/wrong dimensions | Composite FK/check rejection | Test-only 3D vector |
| Mutate ready revision/regress current pointer | Immutability/ordering rejection | No worker execution |
| Failed replacement with old ready pointer | Previous current content remains | SQL state fixture only |
| Other member/admin queries private conversation | Conversation/message/source hidden | No chat API |
| Revoke uncited potential source | Entire answer/sources/feedback hidden | Stored test answer, no generation |
| Incomplete/absent/cross-team provenance | Commit/FK rejection | Cannot prove external provider input |
| Delete then purge; attempt restoration | Invalidation precedes purge; no resurrection | No physical Storage purge |
| Wrong-owner/duplicate feedback | FK/unique rejection | No feedback endpoint |
| UTC period/idempotency/counters/holds/fence reference | Check/unique/FK enforcement | Quota reservation service not implemented |
| Duplicate job and rolled-back outbox | Single logical job; no rolled-back event | No Redis/BullMQ publication |
| Audited role mutation/rollback | Actor/correlation and atomic safe details | Database trigger only |
| Hidden audit target/tampering/unsafe details | Hidden rows omitted; writes/details denied | No audit endpoint/retention job |

## Outside this module

Real token verification/account mapping; Storage policies/downloads/uploads; parsing and worker leases; queue recovery; quota admission/final-slot/fencing orchestration; revocation during actual generation; real-model evaluations; frontend refresh; live final acceptance remain future work. A passing relational fixture test would not establish those integrations.

## Final verification

The original Docker-blocked status above was resolved on 2026-11-19 using a new project-local native PostgreSQL instance. PostgreSQL **18.4** and official pgvector **0.8.7** were used; no system data directory or Docker store was reset. `tools/native-postgres.py` documents the reproducible fallback and keeps generated binaries/clusters under ignored `.tmp`.

Actual successful commands: `npm run build:db`, `npm run db:bootstrap`, `npm run db:migrate`, `npm run db:seed`, `npm run db:inspect`, and `npm run test:db`. The last command passed **1 suite, 25/25 tests**, exit 0, in 17.56 seconds. A previous 24/25 run exposed a test-fixture SQL parameter type conflict; the fixture was corrected and the whole database suite passed. These are real PostgreSQL authorization/constraint/transaction/concurrency checks, not a mocked repository.

Actual demo read matrix: Ali HR -> Leave Policy; Sara HR -> Leave Policy; Sara Engineering -> API Guide; Hina HR -> Leave Policy and Salary Plan; Ahmed Engineering -> API Guide. The fixture remains metadata-only: no real Auth account, original file, embedding request or model response was created by these commands.

Module 1 foundations are verified at this layer. Later module source/checks and any remaining live-service blockers are tracked in `module-progress.md` and `verification-evidence.md`; the earlier historical future-work statements do not describe the final implementation state.
