# Testing and observed results

## Scope and reproduction

Recorded controlled integration tests ran on 21 November 2026 using real PostgreSQL 18.4/pgvector 0.8.7, NestJS/Supertest and signed local Auth fixtures. AI and original-file Storage were controlled test adapters. Their purpose was reproducible authorization, transaction, concurrency and failure ordering. Run `npm run test:all` with the isolated test database configured; it resets that database, never the demo database.

Separate recorded live scenarios ran on 21 and 23 November 2026 using the normal API and worker, real Supabase Auth/private Storage, Redis/BullMQ, Gemini embeddings and Groq answers. Files contained synthetic training facts. The committed [evidence summary](testing-results.json) records the actual outcomes and tested source fingerprints; it is dated evidence, not a fresh execution claim.

## Hard cases

| Action | Actual outcome | Evidence boundary |
| --- | --- | --- |
| Upload as Hina and Sara concurrently | Distinct document/version identities; both Ready; matching originals and separate nonduplicated chunk sets | Actual hosted Storage, Redis worker and embeddings |
| Submit different questions together | Both succeeded when capacity existed | Actual live API/provider and SQL accounting |
| Compete for the final quota slot | One successful answer and one HTTP 429; exactly one charge and zero held remainder | Actual live requests and read-only PostgreSQL ledger observation |
| Repeat an in-flight request key | One saved answer/charge; competing submission conflicted; replay returned the same message | Actual live API/provider; quota ledger checked |
| Delete/revoke while generating | Access loss before final gate blocked completion; if completion won first, it was authorized then and future history became unavailable after access loss | Deterministic provider barriers with real SQL locks; arbitrary real-vendor timing was not separately measured |
| Ask from a restricted document | Ali denied before grant, then received REPORT-742 with a citation after the intended grant | Actual current private-file UUID, hosted original and real answer |
| Revoke that grant | Entire old answer, source, original, feedback target and replay became unavailable | Actual live access/history checks |
| Probe another team or private conversation | HR/Engineering boundaries denied; admin could not read another member's private chat | Real database/API tests and live scenarios |
| Update then delete | New answer used DRILL-926; old citation remained historical DRILL-815; deletion hid dependent answers | Actual live update/activation/citation/deletion; failed/out-of-order activation separately controlled |
| Place malicious instructions in a document | Supported SAFE-415 returned; injected marker absent; hidden Salary Plan source not supplied | One actual real-model synthetic probe, not broad injection immunity |
| Change role, save feedback and inspect audit | Existing Sara token lost upload rights on demotion; role restored; feedback persisted; grant audit matched Hina/document | Actual live API and SQL observations |
| Ask an unsupported/private fact or upload JSON | Fixed insufficient-sources response without a successful-answer charge; unsupported file rejected | Actual live checks plus controlled provider-failure tests |

## Cleanup and corrections

Temporary grants, roles and the original monthly limit were restored. The retained practice original/readers were preserved. Temporary documents were tombstoned and their worker purge jobs succeeded; temporary conversations were purged. Successful saved answers remain charged after chat deletion.

An earlier real-provider response omitted citations and was initially mapped to the wrong HTTP error. The adapter was corrected to discard uncited model text and return the fixed insufficient-sources response; regression and live follow-up checks succeeded. Invalid provider schema/JSON fails safely. Initial test-harness contract/observer mistakes were corrected without weakening application authorization.

## Browser and optional live reproduction

`python tests/browser/smoke.py` runs actual Chrome/UI/API/PostgreSQL with synthetic Auth/AI/Storage. Run it only after Jest and with both app builds ready. It writes screenshots/raw results locally; these do not establish a full real-provider browser matrix.

`tools/check-live-demo.mjs`, `check-live-challenges.mjs`, `check-live-engineering.mjs` and `check-live-final.mjs` are opt-in real-service scenarios. They require configured providers, ordinary demo accounts and an ignored `.tmp/demo-login-credentials.txt`; never commit that file. The final runner also requires the existing matching synthetic Practice Policy.txt, sourced from `demo-files/Report Practice Policy.txt`. Read each script header before execution; successful answers consume quota and test settings are restored where recorded.

## Not established

Broad multilingual/model grounding/injection evaluation; shared Redis outage/lost-queue recovery; arbitrary hosted late-write faults; full automated live-provider browser coverage; production load; real timed UTC rollover; backup/restore drills; malware isolation; automated age retention; independent security certification. Controlled failure tests and a small live example do not establish these broader guarantees. Operational limitations are documented in [operations](operations.md).
