# Secure Multi-Team AI Assistant

TechCo's HR and Engineering teams upload private documents and ask an assistant questions about the documents they may currently read. Answers include inspectable citations. The backend enforces current membership, document permissions, protected chat history, audit records and monthly usage limits.

Stack: Next.js/TypeScript/Tailwind, NestJS, PostgreSQL/pgvector, Supabase Auth/private Storage and BullMQ/Redis. Embedding and answer providers are configurable.

## Submission

- [Final report](output/pdf/secure-multi-team-ai-assistant-report-final.pdf)
- [Simple ER diagram](diagrams/simple-er-diagram.png)
- [Detailed ER diagram](diagrams/schema.svg) and [editable diagram source](diagrams/schema.mmd)
- [Database catalog](docs/database-design.md), [design decisions](docs/design-decisions.md), [test methods and actual results](docs/testing.md)

## Start the existing configured Windows installation

Run commands from the project root. Start the infrastructure first:

```powershell
npm run db:native:start
docker compose up -d redis
```

This setup uses project-local native PostgreSQL on loopback ports 55432 and 55433, plus Docker Redis on 6379. The second PostgreSQL instance is only for destructive tests. Supabase supplies hosted Auth and private Storage; opening its dashboard does not start the local application database. Kubernetes is unnecessary.

After installation or relevant source/environment changes, build:

```powershell
npm run build:api
npm run web:build
```

Keep three terminals open at the project root:

| Terminal | Command | Purpose |
| --- | --- | --- |
| 1 | `npm run api:start` | API on port 3001 |
| 2 | `npm run worker:start` | Processing and cleanup worker |
| 3 | `npm run web:start` | Frontend on port 3000 |

Open [the local app](http://localhost:3000). Run one instance of each process. `GET /health` reports API liveness, not database/provider/worker readiness.

## First installation

Use Node.js 24, npm and Python 3.12+. Install dependencies and create private local configuration:

```powershell
npm ci
npm run db:local:init
```

`db:local:init` creates root `.env` with random local PostgreSQL passwords only if absent. It preserves an existing file. `.env.example` remains the public template; there is no separate `root.env`.

Choose one database runtime:

- **Verified Windows setup:** installed PostgreSQL 18 binaries/development headers and VS 2022 C++ build tools; run `npm run db:native:prepare`, then `npm run db:native:start`. Preparation creates project-local PostgreSQL/pgvector clusters under ignored `.tmp`, without modifying the system PostgreSQL service/data directory. Optional overrides: `NATIVE_PG_INSTALL` and `NATIVE_VCVARS`.
- **Docker alternative:** with native clusters stopped and ports 55432/55433 free, `npm run db:local:up` starts Compose PostgreSQL/pgvector and Redis. Do not start both database runtimes on the same ports. Recorded native PostgreSQL results do not imply an identical Docker-version test run.

With the selected database running, provision and migrate:

```powershell
npm run db:bootstrap
npm run db:migrate
npm run db:seed
npm run db:inspect
```

For native PostgreSQL, also run `docker compose up -d redis`. The seed preserves existing rows and creates metadata only. It does not create Auth accounts, uploaded files or ready embeddings. `db:inspect` demonstrates SQL authorization contexts, not a Supabase login. Never point tests at a populated application database.

## Configure services privately

Edit root `.env` locally. Private keys, passwords and connection strings must not be committed or copied to browser configuration.

| Settings | Purpose |
| --- | --- |
| `MIGRATION_DATABASE_URL`, `API_DATABASE_URL`, `WORKER_DATABASE_URL` | Separate PostgreSQL setup/runtime roles |
| `TEST_DATABASE_URL`, `TEST_API_DATABASE_URL`, `TEST_WORKER_DATABASE_URL`, `TEST_ADMIN_DATABASE_URL` | Isolated test database |
| `SUPABASE_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE` | Same hosted project; issuer ends in `/auth/v1`; audience `authenticated` |
| `SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public project key used for Auth |
| `SUPABASE_SERVER_STORAGE_KEY`, `SUPABASE_PRIVATE_BUCKET` | Server-only secret/service-role key; private bucket `team-documents` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_BASE_URL` | The three public browser settings; local API URL normally `http://localhost:3001` |
| `REDIS_URL` | Local Redis URI or private remote TLS URI |
| `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_API_KEY` | Embedding endpoint, model, dimensions and server key |
| `ANSWER_BASE_URL`, `ANSWER_MODEL`, `ANSWER_API_KEY` | Answer endpoint, model and server key; optional `AI_BASE_URL` is a shared endpoint fallback |
| `API_PORT`, `WEB_ORIGIN` | Normally `3001` and `http://localhost:3000` |

Apply [the private-bucket SQL](database/supabase/private-storage.sql) in the selected Supabase project. A publishable key cannot replace the server Storage secret. Ordinary users cannot access this dedicated bucket directly; the backend checks current permissions before and after original-file I/O.

The demonstrated provider configuration uses Gemini embeddings and Groq answers with synthetic files. See [provider setup](docs/free-ai-setup.md) and the optional [remote Redis recipe](docs/free-redis-setup.md). Free limits/terms can change. Changing the embedding endpoint/model/dimensions/chunker requires a planned reindex; do not change it under existing ready documents.

Create the demo accounts in Supabase Auth. Privately record their Auth subject UUIDs in `.tmp/demo-subjects.json` under `ali`, `sara`, `hina`, `ahmed`, then bind them before their first app login:

```powershell
npm run demo:bind
npm run env:web
```

`demo:bind` verifies existing identities and refuses conflicting profile bindings. It does not create/reset passwords. `env:web` creates `apps/web/.env.local` with only the public browser values and preserves an existing file. Update public values there manually when required and rebuild the frontend. Restart API/worker after server configuration changes.

## Roles and document behavior

| Person | HR | Engineering |
| --- | --- | --- |
| Ali | Viewer | None |
| Sara | Editor | Viewer |
| Hina | Admin | None |
| Ahmed | None | Admin |

Engineering has no editor; Ahmed can upload as admin. New uploads are restricted to their uploader. `Queued` means background work was accepted; `Ready` means the revision can support answers. Metadata-only seeded documents can remain `Not Uploaded`.

To grant read access, use Documents **Copy ID**, paste the complete document UUID in Admin and choose the intended current member. Admin has no implicit read of another uploader's restricted file or another member's private chat; explicit self-grant is possible and audited. A blind acknowledgement alone does not prove the intended reader can access the file.

Updates keep the old ready version until a newer revision succeeds. Deletion blocks access immediately and schedules physical cleanup. Current permissions also protect old answers, sources, downloads, feedback and replay. See [the rules and reasons](docs/design-decisions.md).

## Testing

With the isolated test PostgreSQL instance running:

```powershell
npm run test:all
```

This builds the API and runs real PostgreSQL/Jest/Supertest checks sequentially. Controlled Auth/AI/Storage fixtures make failure timing reproducible. Actual results and remaining limits are in [testing](docs/testing.md) and [the compact evidence record](docs/testing-results.json).

Optional browser testing requires Chrome, both application builds and Python Playwright:

```powershell
python -m pip install -r requirements-tools.txt
python tests/browser/smoke.py
```

Never run browser checks concurrently with Jest: both reset the isolated test database. Browser fixtures use synthetic Auth/AI/Storage. Generated raw results and screenshots are ignored locally; they are not part of the submission.

Opt-in `tools/check-live-*.mjs` scripts require real configured services and private demo credentials. Read each header before `--run`: they can spend provider/app quota and temporarily alter synthetic fixture permissions, roles or budgets before restoration. They are not automatic startup commands.

## Troubleshooting and operations

- Empty teams plus a service error: confirm local PostgreSQL and retry protected `/me` and `/teams`; a failed lookup does not prove membership removal.
- Worker unavailable: confirm PostgreSQL and Redis. `docker compose exec redis redis-cli ping` should return `PONG`; restart the worker from the project root.
- Queued/failed uploads or unavailable answers: inspect API/worker diagnostics privately and verify actual Storage/provider settings.
- Account-specific login failure: check the real Supabase account/password/confirmation; local notes do not change Auth passwords.

[API reference](docs/api.md) and [operations and limits](docs/operations.md) describe endpoints, authorization, retry/retention behavior and work required before production use. This is a local MVP; no production availability or broad model-safety guarantee is claimed.

Source layout: `apps` application; `database` migrations/seed/bucket SQL; `tests` reproducible checks; `tools` setup/acceptance/packaging; `demo-files` synthetic inputs; `docs` essential documentation; `diagrams` database visuals; `output/pdf` approved final report.

`npm run package:source` creates an allowlisted secret-scanned archive using the approved report. It requires private root `.env` for its exclusion scan. Real credentials, dependencies, runtime data and local archives stay outside Git.
