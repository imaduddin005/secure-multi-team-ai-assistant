# Secure Multi-Team AI Assistant

A local web application for TechCo's HR and Engineering teams. Members ask questions from documents they may currently read. Answers have inspectable citations; access changes also protect old answers, sources and replayed requests.

Application data lives in local PostgreSQL + pgvector. Supabase supplies hosted login and private file Storage. Opening the Supabase dashboard does not start the local application database. Redis delivers background work; PostgreSQL keeps the durable job record.

Stack: Next.js, NestJS, PostgreSQL/pgvector, Supabase Auth/private Storage, BullMQ/Redis, configurable Gemini embeddings and Groq answers. Missing credentials never enable a fake production fallback.

## Run the existing configured Windows project

Use VS Code's terminal in the project folder. Node.js 24, npm and Python 3.12+ are required. Docker Desktop's Linux engine must be running for Redis; Kubernetes is unnecessary.

Start the database and Redis **before** the three application terminals:

```powershell
npm run db:native:start
docker compose up -d redis
```

The verified setup uses project-local native PostgreSQL on `127.0.0.1:55432` (`assistant`) and an isolated test cluster on `55433` (`assistant_test`). Redis uses loopback port `6379`. These commands do not reset data. Do not also start Compose PostgreSQL on these ports. After restarting Windows, repeat these prerequisites.

For an existing installation, apply migrations safely after a source update:

```powershell
npm run db:migrate
npm run db:seed
```

The seed preserves existing rows and creates metadata, **not** Auth accounts or uploaded file contents. Build after installation, code changes or relevant environment changes:

```powershell
npm run build:api
npm run web:build
```

Keep these three terminals open, each at the project root:

| Terminal | Command | Purpose |
| --- | --- | --- |
| 1 | `npm run api:start` | Backend on port 3001 |
| 2 | `npm run worker:start` | Background file processing and cleanup |
| 3 | `npm run web:start` | Frontend on port 3000 |

Open [the local application](http://localhost:3000). Start only one instance of each service; `EADDRINUSE` means another process already owns its port. A running frontend alone does not establish database, worker or AI readiness.

## First installation on a new computer

The source package excludes credentials, database data, dependencies and copied PostgreSQL binaries. It does not recreate the developer's local accounts/data automatically.

1. Install Node.js 24 and Python 3.12+, open the project folder and run:

   ```powershell
   npm ci
   npm run db:local:init
   ```

   `db:local:init` creates root `.env` with random local database credentials only if absent; existing configuration is preserved. Keep `.env.example` as the placeholder template. There is no separate `root.env` file.

2. Choose one PostgreSQL runtime:
   - Verified Windows path: installed PostgreSQL 18 binaries/development headers and VS 2022 C++ build tools, then `npm run db:native:prepare` and `npm run db:native:start`. Preparation copies binaries into ignored `.tmp/pgsql`, builds official pgvector 0.8.7 and creates new project clusters. It does not modify the system PostgreSQL service/data directory. Optional paths: `NATIVE_PG_INSTALL`, `NATIVE_VCVARS`.
   - Separate Docker alternative: with native clusters stopped and these ports free, `npm run db:local:up` starts Compose PostgreSQL 17/pgvector plus Redis. Do not mix runtimes. Recorded PostgreSQL 18 results do not establish an identical Docker-version test run.

3. With native PostgreSQL, start Redis with `docker compose up -d redis`. Provision and migrate:

   ```powershell
   npm run db:bootstrap
   npm run db:migrate
   npm run db:seed
   npm run db:inspect
   ```

   `db:inspect` demonstrates database contexts; it is not a Supabase login. Never point tests at a populated application database. Without Docker, see the [user-owned TLS Redis alternative](docs/free-redis-setup.md).

4. Configure hosted services below, bind the demo identities, generate public frontend settings, build and start the three application terminals.

## Environment and hosted services

Edit the existing root `.env` locally. Never paste real secrets into chat, commit them or copy the whole file to the frontend.

| Variables | Meaning |
| --- | --- |
| `MIGRATION_DATABASE_URL`, `API_DATABASE_URL`, `WORKER_DATABASE_URL` | Separate local PostgreSQL roles; runtime roles are not owners and cannot bypass RLS |
| `TEST_DATABASE_URL`, `TEST_API_DATABASE_URL`, `TEST_WORKER_DATABASE_URL`, `TEST_ADMIN_DATABASE_URL` | Dedicated isolated test credentials |
| `SUPABASE_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE` | Same hosted project URL; issuer ends in `/auth/v1`; audience `authenticated` |
| `SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public key also used for supported Auth verification |
| `SUPABASE_SERVER_STORAGE_KEY`, `SUPABASE_PRIVATE_BUCKET` | Backend-only secret/service-role credential; private bucket `team-documents`. A publishable key cannot replace this server secret |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_BASE_URL` | The three browser settings; API URL normally `http://localhost:3001` |
| `REDIS_URL` | Local `redis://localhost:6379` or a private remote TLS URI |
| `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_API_KEY` | Embedding endpoint/model/dimension/server key |
| `ANSWER_BASE_URL`, `ANSWER_MODEL`, `ANSWER_API_KEY` | Answer endpoint/model/server key; optional `AI_BASE_URL` is a shared endpoint fallback |
| `API_PORT`, `WEB_ORIGIN` | Normally `3001` and `http://localhost:3000` |

The demonstrated profile uses Gemini `gemini-embedding-2` with 768 dimensions and Groq `openai/gpt-oss-20b`. See [free-provider setup/data-use limits](docs/free-ai-setup.md). Use supplied **synthetic** documents. Provider terms/free quotas are separate from app quotas, and model availability can change. Changing the embedding profile requires a planned reindex/cutover.

Apply [private bucket SQL](database/supabase/private-storage.sql) in the selected Supabase SQL editor. It blocks direct ordinary-user access to this dedicated bucket. The backend checks app permissions before and after original-file I/O. Server credentials remain privileged.

Create four demo accounts in Supabase Authentication. Privately record their Auth subject UUIDs in `.tmp/demo-subjects.json` with keys `ali`, `sara`, `hina`, `ahmed`. Before their first app login, run:

```powershell
npm run demo:bind
npm run env:web
```

`demo:bind` verifies existing Auth identities and binds the seeded profiles, refusing conflicting bindings. It does not create/reset passwords. `env:web` creates `apps/web/.env.local` with only the three public values and preserves an existing file. Update public values there manually when needed, then rebuild the frontend. Restart API/worker after changing server settings.

Ignored credential notes are private local conveniences, **not submission files**. Passwords are managed by Supabase Auth; editing a text file alone does not change an account password. No passwords are embedded here.

## Roles and document rules

| Person | HR | Engineering |
| --- | --- | --- |
| Ali | viewer | no membership |
| Sara | editor | viewer |
| Hina | admin | no membership |
| Ahmed | no membership | admin |

Engineering has no editor; Ahmed can upload as admin. Roles belong to memberships. Viewer asks; editor also uploads/updates/deletes readable files; admin also manages members, sharing and budgets. Admin has no implicit read of another uploader's restricted file or another member's private chat. A trusted same-team admin can explicitly self-grant through an audited operation.

New uploads start Restricted to the uploader. `Queued` means accepted for background work; `Ready` means processing succeeded. The current UI provides a queued notice and a Ready row without a separate completion toast. Seeded `Leave Policy`/`API Guide` can remain `Not Uploaded`: metadata is not a question-ready source. Retained synthetic HR/Engineering handbooks and Salary Plan have separate live evidence.

Sharing: **Documents -> Copy ID -> Admin -> paste the complete UUID -> choose the intended member -> Grant read**. `03` is a test number, not a document UUID. Selecting Hina does not grant Ali access. The blind acknowledgement deliberately does not reveal whether an otherwise unreadable resource exists; verify access as the intended reader. Use the actual title: `Practice Policy.txt` differs from `Report Practice Policy 01`.

Updates create immutable revisions; only a successfully processed newer revision becomes current. Deletion tombstones immediately, then the worker purges originals/chunks. Changing teams requires an authorized new upload with fresh sharing rules. Membership removal and role changes use current database checks. If any evidence source becomes unreadable, the entire old assistant answer/citations/feedback/replay become unavailable. Already delivered bytes cannot be recalled.

## Tests and actual evidence

With the isolated test cluster running:

```powershell
npm run test:all
```

This builds the API and runs real PostgreSQL/Jest/Supertest checks sequentially. AI/Storage and local signed Auth fixtures are explicitly test-only. The recorded 2026-11-21 run verified database authorization, transactions, concurrency and application behavior successfully. `docs/test-run.json` preserves exact case results and tested source hashes; this is not a fresh rerun claim.

Optional Chrome/Python Playwright browser check after builds:

```powershell
python tests/browser/smoke.py
```

It starts only its own fixture processes and resets the same isolated test DB. **Never run concurrently with Jest.** The recorded browser scenarios completed with synthetic Auth/AI/Storage. Full real-provider browser coverage remains separate.

Live runs use synthetic documents and normal production processes:

| Evidence | Actual result |
| --- | --- |
| `docs/live-demo-run.json` | HR handbook upload, processing, authorized original access and grounded answers with citations succeeded |
| `docs/live-challenges-run.json` | Salary Plan restrictions, grant/revoke, concurrent questions, last quota slot and duplicate replay behaved as recorded |
| `docs/live-engineering-run.json` | Engineering upload/citations succeeded; viewer administration/upload and cross-team reads were denied |
| `docs/live-final-run.json` | On 2026-11-23: intended practice-file grant enabled an answer, revoke hid it; parallel uploads reached Ready; update/deletion, feedback/audit, role restore, quota and a limited malicious-source probe behaved as recorded |
| `docs/manual-test-observations.json` | 11 unique learner screenshots, including partial/confounded attempts; not 11 automatic passes |

The final run restored the learner file/readers, roles and original 1,000-answer limit; 3 temporary documents were tombstoned and their worker purge jobs succeeded; 7 temporary chats were purged. Successful answers remain charged. Earlier runner contract/observer failures are retained separately. Counts refer to different dated scenarios, not unique guarantees.

Opt-in runners: `tools/check-live-*.mjs`. Read their headers before `--run`: real credentials/services are required, free provider quota is consumed, and synthetic permissions/budgets may change temporarily. The final runner expects the matching learner `Practice Policy.txt` and refuses ambiguous/different originals. See [requirement review](docs/requirements-review.md) and [verification evidence](docs/verification-evidence.md) for methods/gaps.

## Troubleshooting

| Symptom | Check/action |
| --- | --- |
| Empty teams plus `Service unavailable` | Start native PostgreSQL and retry `/me`/`/teams`, then refresh/sign in. A failed lookup does not prove membership removal. |
| `Reconciliation unavailable` / `Queue worker unavailable` | Confirm PostgreSQL and Redis. `docker compose exec redis redis-cli ping` should return `PONG`. Restart the worker from the root. Durable work remains in PostgreSQL. |
| File stays Queued/Failed | Inspect worker diagnostics privately and check real Storage/embedding settings. |
| One user cannot login | Verify the Supabase account/password/confirmation; browser autofill may have an old password. Local notes are not the Auth database. |
| Invalid/expired access token | Sign out/in; check matching Supabase project/issuer/public key and server time. Never attach tokens to a report. |
| Chat `Service unavailable` | Inspect API diagnostics privately; database/AI/Storage failures have different causes. Supabase dashboard visibility alone proves little. |
| No upload/Admin buttons | Check the selected team's role; expected for viewers. |
| No private answer | Verify Ready, exact title, correct UUID and intended grantee; an acknowledgement alone is insufficient evidence. |

`GET /health` reports API liveness only. Known notification/feedback/retry limitations are in the report. This is a local learning MVP, not a production-availability claim.


Source layout: `apps` application; `database` migrations/bucket SQL; `tests` controlled checks; `docs` decisions/evidence; `diagrams` editable/rendered diagrams; `demo-files` synthetic inputs; `tools` setup/acceptance/report/packaging.
Optional artifact tools: `python -m pip install -r requirements-tools.txt`, then `python tools/create-word-report.py` or `npm run report:build`. The simplified diagram must already exist. Render the DOCX with an actual Word processor and inspect every page before release. `python tools/package-source.py` uses the approved final PDF when present and creates an allowlisted secret-scanned ZIP; local root `.env` is required for exclusion checks. Never ZIP the whole workspace: private credentials, database data, originals, dependencies and runtime artifacts are excluded. Raw `learner-test-kit/results` contains a private password file and must not be attached wholesale.

