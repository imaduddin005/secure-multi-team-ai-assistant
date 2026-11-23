# Module 1: database foundations

Status and executed outcomes are in `module-progress.md` and `module-1-evidence.md`. This module contains real SQL migrations and executable TypeScript database tooling. Authentication, HTTP APIs, private object storage, workers, quota orchestration, and AI chat are not implemented here.

## What the implementation provides

The following items are defined in executable source files. Their effective PostgreSQL behavior remains unverified until the migrations and real integration tests run; see the evidence.

- 21 business tables in `app`, plus `app_meta.schema_migrations` for migration versions/checksums. The extra operational table is not an additional business entity.
- Composite same-team foreign keys for memberships, grants, files/version metadata, chunks, conversations, message sources, feedback, and usage attempts.
- Active membership uniqueness; terminal removal; automatic grant revocation on removal; a deferred last-admin/team-budget invariant and team locking.
- Restricted-by-default document records and a deferred initial uploader-grant check. The safe fixture deliberately marks Leave Policy/API Guide team-visible.
- Immutable revision identity, compatible embedding dimensions, duplicate chunk prevention, current-ready pointer validation and no version regression. These do not constitute a processing worker.
- Private conversation ownership; finalized assistant provenance completeness; immutable source binding; all-potential-source read checks; synchronous answer invalidation on logical document deletion before source/chunk purge.
- Quota table/period/unique-hold/idempotency foundations. No reservation/admission/generation/expiry service yet; final-slot enforcement belongs to Module 5.
- Append-only audit with allowlisted non-content details; scoped audit reads. Database triggers record current implemented metadata mutations, not claims of completed uploads or live processing.
- Forced RLS, separated roles and read policies. Runtime writes remain denied until a later module supplies its narrowly authorized command functions.

## Technology choices

PostgreSQL is the real database server; pgvector supplies the real vector type and operators. Docker Compose describes two independent local PostgreSQL services. The demo uses `127.0.0.1:55432/assistant`; tests use `127.0.0.1:55433/assistant_test`. The pinned image is `pgvector/pgvector:0.8.7-pg17`; runtime versions and successful image acquisition must be recorded in evidence, never inferred from a tag.

Node.js runs TypeScript compiled with `tsc`; `pg` sends parameterized SQL over actual PostgreSQL connections. Jest executes the compiled integration tests. There is no Next.js/NestJS application scaffold in this module. SQL-first migrations make constraints, locks, and RLS visible; an ORM remains an alternative, not a required dependency.

The initial Jest 30 dependency tree produced moderate transitive audit findings. The module uses compatible Jest 29.7.0 and matching types, which were installed and re-audited. The report is a dated dependency check, not a guarantee about all future vulnerabilities.

## Files and responsibilities

| Path | Responsibility |
| --- | --- |
| `compose.yaml` | Separate loopback-only demo and test PostgreSQL services/volumes |
| `database/bootstrap.sql` | Provision distinct roles and pgvector using an administrator |
| `database/migrations/001_schema.sql` | Tables, FKs, checks, indexes, deferred circular pointers |
| `database/migrations/002_security.sql` | RLS, metadata helpers, minimal runtime privileges, current-ready retrieval view |
| `database/migrations/003_integrity.sql` | Last-admin, immutable identities, provenance/invalidation, audit triggers |
| `database/seeds/techco.sql` | Idempotent metadata-only TechCo fixture; no passwords/files/accounts |
| `tools/database/config.ts` | Local-only URL validation, safe non-overwriting env creation, demo identifiers |
| `tools/database/database.ts` | Bootstrap, checksum migrations, transaction-local context, transactional seed |
| `tools/database/cli.ts` | Safe commands and a labelled database-context demo |
| `tests/database/fixtures.ts` | Explicitly test-only text/vectors/metadata; no Storage/AI adapter |
| `tests/database/boundaries.test.ts` | Real connections, privileges, constraints, RLS and controlled last-admin race |
| `package.json`, `package-lock.json`, `tsconfig.database.json`, `jest.database.config.cjs` | Reproducible tools, compiler, test runner |

## Exact setup commands

Use PowerShell from the actual laptop repository. Docker Desktop's Linux engine must be healthy before `up`.

```powershell
Set-Location -LiteralPath 'C:\Users\DELL\OneDrive\Documents\secure-multi-team-ai-assistant'
npm ci
npm run db:local:init
npm run db:local:up
npm run db:bootstrap
npm run db:migrate
npm run db:seed
npm run db:inspect
npm run test:db
```

For the first authoring run `npm install` created the lockfile; subsequent installations use `npm ci`. Setup does not remove volumes or reset the demo database. `npm run db:local:stop` stops only this Compose project's services while preserving volumes. Do not use `down -v` as a routine fix.

Useful independent checks:

```powershell
npm run build:db
npm run test:db -- --listTests
docker compose config --quiet
npm audit
```

Listing tests proves discovery, not test execution. `config --quiet` avoids printing the interpolated passwords. Do not paste `docker compose config`, `.env`, connection strings, or private logs into chat.

## The actual configuration file

The tools read the **root `.env`** using Node 24's `--env-file-if-exists=.env` option. `.env.example` remains a placeholder template. `db:local:init` copies the template only when `.env` is absent and generates eight random local passwords plus matching connection URLs. If `.env` exists, it is preserved byte-for-byte. No public Supabase/AI value is required for Module 1.

If a pre-existing `.env` contains placeholders, edit the root `.env` locally and fill only the database settings shown in `.env.example`; do not replace populated Supabase/other configuration. Main and test passwords are separate. The `LOCAL_*`/`TEST_*` administrator URLs are provisioning credentials, not API credentials. Keep the real `.env`, named-volume data, dependency folders, and generated `dist` out of commits/submission archives. Dotfiles begin with a literal dot and may be hidden in a file manager.

Bootstrap is deliberately limited to the dedicated loopback databases. Before any provisioning writes, it checks the expected `cluster_name` (`secure-assistant-demo` or `secure-assistant-test`). Tests verify the test name again before schema reset. They never reset the demo schema. This protects unrelated databases on the laptop. A custom local PostgreSQL installation must be explicitly configured with these database/cluster identities before these commands accept it.

The shared root `.env` is for local provisioning/development tools. Before a real API/worker process is introduced, give each process only its own runtime secrets; do not hand migration/administrator credentials to the API by loading the entire provisioning environment. Production secret separation is not demonstrated by this local file.

## PostgreSQL roles versus membership roles

`viewer/editor/admin` are business roles on a membership. `app_api/app_worker/app_migrator` are **database connection roles**, each with its own credential. The future backend will use `app_api` while establishing the verified person's transaction-local identity context; it must never switch to the table owner to bypass a denied request.

| Role | Effective boundary |
| --- | --- |
| `app_owner` | NOLOGIN schema/table owner; explicit broad owner policies, DDL power |
| `app_migrator` | Separate login, NOINHERIT; can explicitly `SET ROLE app_owner` for migration/seed |
| `app_api` | Non-owner/NOBYPASSRLS; SELECT only under policies and no storage-locator table grant |
| `app_worker` | Non-owner/NOBYPASSRLS; intentionally broad trusted processing metadata/chunk reads; no private message-body read |
| `app_policy_reader` | NOLOGIN; selected metadata columns only; boolean helpers avoid recursive RLS |
| `app_commands` | NOLOGIN; trusted trigger/function owner, broad internal DML policies, append-only audit insertion |

All 21 application tables enable and force RLS. **FORCE does not mean the owner is powerless:** the owner has an explicit broad policy and can alter tables/policies. Superusers/BYPASSRLS and compromised trusted functions/credentials remain outside end-user isolation. Worker access is intentionally broader than an end user's. [PostgreSQL RLS behavior](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

The context demonstration/tests use `SET LOCAL` values supplied by a trusted test/tool process. This is not real authentication and is not an unforgeable identity mechanism inside PostgreSQL. A person holding the API database password could spoof that context. Module 2 must verify real Supabase tokens before establishing it. No ordinary Supabase public role is granted this application schema; hosted-role/schema exposure remains to be verified against the chosen Supabase deployment.

## Important SQL mechanics

A composite FK carries both row ID and `team_id`, so an Engineering member cannot be paired with an HR document. A partial unique index permits historical removed memberships but only one active user/team pair. A new membership ID prevents inherited grants and private chats on rejoin.

Function permissions are revoked/granted while the migration role still owns them, then transferred to the NOLOGIN helper/command owner. The target role receives temporary schema CREATE permission for that transfer. Function EXECUTE defaults are revoked globally for the migration owner; a per-schema revoke cannot remove a globally granted default. These ordering rules were checked against [ALTER FUNCTION](https://www.postgresql.org/docs/17/sql-alterfunction.html) and [ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html); their actual migration execution remains pending.

Deferred checks run at commit, allowing a transaction to create a team/budget/first admin or document/uploader grant together. The last-admin guard serializes on the team row and rechecks after waiting. The concurrency test observes a real blocked connection using `pg_blocking_pids`, rather than guessing a race with sleeps. Later mutation commands must acquire the team gate **before** touching dependent rows; ad hoc owner SQL may still deadlock and need retry, even though the invariant is protected.

Assistant messages have `expected_source_count` and `finalized_at`, added during implementation. Sources attach while the message is unfinalized; commit requires a finalized complete set and a displayed citation for a grounded answer. This can verify the stored set, not prove which bytes an external provider actually received. Module 6 must bind the exact supplied context and validate provider references/grounding.

`document_grants.revoked_by_system` records automatic membership-removal revocations without inventing a human actor. User revocation and system revocation are mutually exclusive. The schema diagram remains an overview; the implementation additions are documented in `database-design.md`.

Audit details are explicitly allowlisted and exclude titles, text, secrets, and feedback comments. The target is an opaque generic reference without an FK, preserving evidence after target deletion. App API/worker roles cannot modify audit records. No retention job or audit UI exists yet.

## Safe fixture and separate real provisioning

Seed creates TechCo; HR/Engineering; four user profiles; five memberships; two budgets; and three document metadata rows with uploader grants. It creates **zero versions, chunks, storage objects, or Supabase accounts**. Synthetic Auth subjects are visibly fixture identifiers, not working login identities. Rerunning seed does not overwrite role, grant, budget, or document changes.

After the relevant modules exist, privately create real Auth accounts through Supabase's supported interface, map verified subjects using a controlled provisioning procedure, and upload actual files through the authorized API. Never store demo passwords in SQL/source or claim these rows make login/upload work. That procedure is not run in Module 1.

## Small learner exercise

```powershell
npm run db:inspect -- --member sara-engineering
```

After successful infrastructure/bootstrap/migration/seed, expected output includes only `API Guide`. Sara's Engineering membership does not authorize HR documents even though she also has a different HR membership. The command is a database-context demonstration, not a Supabase login or upload-permission endpoint test.

## Pending functionality and limits

No real token verification, member-management API, document upload/download, Storage policy enforcement, BullMQ worker/outbox publisher, provider call, quota admission service, chat generation, streaming, frontend, deployment, or final report is claimed. No real PostgreSQL result may be inferred from TypeScript compilation. Executed database outcomes and infrastructure blockers belong in `module-1-evidence.md`. Stop at the end of Module 1; Module 2 requires a new next-module instruction.
