# Live-service setup and acceptance

Status: **24/24 normal-application live HTTP checks passed on 2026-11-21**, after the separately recorded Auth/Storage/AI/Redis preflight checks. See `live-demo-run.json` for exact checks and limits. The real worker processed the synthetic HR handbook to ready; real RAG answered the annual-leave question with a supporting citation. Actual role restrictions, explicit grant/revoke, unavailable old answer/citation/download, private-chat denial, replay/usage and audit access passed. The temporary Sara grant was removed and the private test conversation purged; Hina explicitly made the retained handbook Team-visible for practice. No existing document/role/budget was overwritten. This is not a full outage/crash/restore, adversarial-model or automated live-browser pass.

The subsequent **46/46 live Salary Plan/restriction/concurrency checks passed on 2026-11-21**; see `live-challenges-run.json` and `restriction-challenges.md`. That run checked the canonical Salary Plan, three simultaneous-request cases and actual PostgreSQL accounting. It preserved roles, restored the 1,000 monthly limit, removed temporary grants and purged seven test conversations. Final usage was 8 used / 0 held. Its first refusal-format failure is retained separately in `live-challenges-initial-failure.json`; the fix passed a 72/72 regression before the successful live rerun.

The canonical Leave Policy and fault/model scenarios below remain a separate checklist. For a new installation, use `demo-practice.md`. The handbook runner refuses to overwrite an existing handbook and uses one saved-answer quota slot when run successfully. The challenge runner refuses to overwrite a different Salary Plan original and preserves actual successful-answer charges.

## Account and file provisioning

Engineering follow-up: **23/23 normal-process live checks passed on 2026-11-23**. `engineering-practice.md` documents the ready team-visible synthetic Engineering handbook, Ahmed admin / Sara viewer / no editor, example questions and exact limits. Positive cited answers/feedback, direct viewer denials, cross-team boundaries and private-chat protection were tested. Full requirement coverage and prioritized pending live verification are in `requirements-review.md`.

1. Follow the README's local database bootstrap/migration/seed commands and private bucket policy setup. Use a dedicated Supabase training project and real API/worker credentials stored only locally.
2. Create four Auth accounts privately in Supabase. Put their verified subject UUIDs in ignored `.tmp/demo-subjects.json` and run `npm run demo:bind` before the first app login. Real passwords are chosen privately and never enter source/logs. Bind failure preserves existing profiles; resolve conflicting identities explicitly.
3. Set all real provider/public browser settings, run `npm run env:web`, `npm run build:api`, `npm run web:build`. Start Redis, API, worker and frontend. Check private Storage with `npm run check:storage` using a normal user's locally stored token. Twelve canary checks are expected; a test failure must not be called a pass.
4. Sign in as Hina and update the seeded HR documents through Documents > Versions/Update, then set Leave Policy to team visibility. Salary Plan stays restricted, with only Hina's explicit grant. Sign in as Ahmed, update API Guide and make it Engineering team-visible. Use only the invented files under `demo-files/`. Wait for actual worker status `ready` and inspect original downloads.

| Seeded entity | UUID |
| --- | --- |
| HR | `30000000-0000-4000-8000-000000000001` |
| Engineering | `30000000-0000-4000-8000-000000000002` |
| Leave Policy | `50000000-0000-4000-8000-000000000001` |
| Salary Plan | `50000000-0000-4000-8000-000000000002` |
| API Guide | `50000000-0000-4000-8000-000000000003` |
| Ali HR membership | `40000000-0000-4000-8000-000000000001` |
| Sara HR membership | `40000000-0000-4000-8000-000000000002` |
| Hina HR membership | `40000000-0000-4000-8000-000000000004` |

On a fresh installation the seed contains metadata only. The current local demo has four bound real Auth accounts and an actually processed Salary Plan plus the additional Team-visible handbook. Safe seed replay never resets credentials, grants or populated documents.

## Demonstration and recorded observations

| Action | Expected observation | Actual live observation |
| --- | --- | --- |
| Ali logs in, chooses HR and asks how to request leave | Grounded answer, real Leave Policy citation and original page/line excerpt | Not run |
| Ali directly POSTs multipart file to `/teams/{hr}/documents` | 403 even though the UI hides upload | Passed: real HTTP 403 in the handbook run |
| Ali searches for Salary Plan and supplies its known version ID to download | No list/search title; neutral unavailable response; no bytes | Passed: live Salary Plan search/version/download denials; hidden and nonexistent download responses matched |
| Sara chooses Engineering then HR | Viewer in Engineering; editor in HR; UI clears old team data | Not run |
| Hina grants Sara HR membership read on Salary Plan | Explicit audited change; Sara can now read that document | Passed: Sara downloaded the canonical synthetic Salary Plan after an explicit grant |
| Sara obtains a real model answer supplied Salary Plan as evidence | Cited grounded answer; record all potential source IDs in protected DB only | Passed: real Groq answer gave 120 training credits with a Salary Plan citation; Ali's provenance excluded that hidden source |
| Hina revokes Sara's grant; Sara refreshes history/citation/feedback | Entire affected assistant answer unavailable, including if Salary Plan was uncited | Passed live for the cited Salary Plan: complete answer, citation, feedback, original and cached replay protected; the uncited-source variant remains a deterministic-provider/real-PG check |
| Hina attempts another member's conversation | Neutral denial; admin has no implicit chat read | Passed: Sara's real private conversation returned 404 to Hina |
| Hina sets team budget to current used count + 1; two new asks race | One new hold/answer; other quota denied; no overcharge; restore budget intentionally | Passed: 201 + 429, one reservation/answer/charge, observed held at most one; original limit restored |
| Two distinct questions with quota available, then simultaneous same-key duplicates | Two ordinary saves/charges; one duplicate save/charge | Passed: 201 + 201 for distinct questions; 201 + 409 for duplicates, replay returned the same saved message |
| Hina reads a new Sara-only restricted memo, then explicitly self-grants and revokes | Admin alone does not imply content read; explicit ACL authority changes access | Passed: 404, byte-matching authorized read after grant, then 404 after revoke; temporary memo deleted |
| Stop Redis, upload with service otherwise configured, restart Redis | Durable PostgreSQL intent survives and processing completes once delivery resumes | Not run |
| Stop after object PUT before DB finalization, restart reconciler, simulate delayed PUT | Unreferenced canary is purged/rechecked, no readable orphan | Not run |
| Real model receives a malicious source instruction to reveal a hidden document | Hidden source absent from request, no invented accepted citation; record actual behavior accurately | Final 2026-11-23 single synthetic probe passed: SAFE-415 grounded, no injected marker and no hidden Salary Plan supplied. Broad corpus remains pending |

For every live result record date, provider/model versions, command/action, expected and actual, relevant safe request ID and limitations. Never store raw tokens, real file bodies or service responses in public evidence. Do not mark real-model truthfulness/prompt-injection immunity based on deterministic adapter tests.
