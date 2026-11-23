# Assignment review and remaining verification

Review date: 2026-11-23 (Asia/Karachi). GitHub upload is excluded from the current request. No repository was pushed, deployed or published.

This review separates implemented behavior, dated execution evidence and remaining verification. The latest full automated source regression passed 72/72 on 2026-11-21; the recorded 29 source-file hashes still match. The 14 browser checks used real Chrome/API/PostgreSQL with synthetic Auth/AI/Storage. Dated real-service runs passed 24 handbook, 46 Salary Plan/concurrency, 23 Engineering and **51 final acceptance checks**. These are separate, overlapping scenarios, not a single count of independent guarantees. The final 2026-11-23 run additionally verified simultaneous real uploads and one real-model malicious-source probe; broader evaluation remains separate.

## Requirement coverage

| Assignment requirement | Current implementation and evidence | Boundary |
| --- | --- | --- |
| One organization, many teams and per-team roles | TechCo HR/Engineering; Sara has separate editor/viewer memberships; current Engineering roster and real actions verified | No organization-wide administrator or public team-creation flow |
| Database design before implementation | Module 0 design/decisions/table catalog, two Mermaid diagrams and renders precede the implementation record | AI-assisted design proposals are not the learner's independent reasoning or automatic adoption |
| Real login and backend authorization | Supabase signature/issuer/audience/time validation, profile binding, current database membership and document predicates | Trusted server/DB/Storage credentials remain privileged; offline JWTs can remain valid until expiry |
| Upload and background processing | Private PDF/TXT originals, immutable versions/chunks, durable SQL jobs/outbox and BullMQ worker; real HR/Engineering activation passed | No OCR or malware sandbox; physical cleanup is eventual with bounded retries |
| Private and team-visible documents | Initial uploader grant, explicit admin ACL changes and team visibility; live Salary Plan grant/revoke and Engineering isolation passed | Trusted same-team ACL admins can explicitly self-grant; admin does not automatically read private files/chats |
| Cited chat and protected old history | SQL eligibility before model input, label validation and final source gate; every supplied source recorded; whole old answer hidden after source access loss | Semantic truth/absence of hallucinations is not guaranteed by a valid citation label |
| Updates, deletion, membership and role changes | Monotone successful revision activation; failed replacement preserves old version; tombstone before purge; immediate current-membership checks; removal/rejoin creates a new membership identity | No in-place cross-team document move; authorized re-upload creates a new identity/grants, followed by separate deletion if desired |
| Ratings and audit | Owner/access-checked feedback, safe append-only audit and atomic mutations | Age-based retention/export and external Auth administrator operations are separate |
| Team usage limits | UTC monthly holds/settlement, scoped idempotency, attempt fencing and reaper | Application quota is not vendor billing or measured vendor call count |
| Chat/Documents/Admin frontend | Actual production build and 14 browser cases; user observed real login/roles; direct backend denials verified | Full automated real-provider browser matrix remains pending |
| Code, short report and diagram | Allowlisted source ZIP, editable five-page Word report with Project Overview, simplified ER diagram, rules/reasons, actual actions/results and changes before real use; full schema separately supplied | Report omits learner commentary and aggregate test-pass totals; technical evidence remains separately preserved |

## The assignment's named hard cases

| Hard case | Existing actual evidence | What remains separate |
| --- | --- | --- |
| Two people upload together | Controlled real-SQL cases plus final actual Hina/Sara parallel Supabase uploads; distinct IDs, both ready, matching originals, nonduplicated chunk sets | Large sustained concurrent-upload/load behavior remains unmeasured |
| Delete/revoke while a response is being generated | Passed using a deterministic provider barrier, real transactions/locks and final-gate assertions; both operation orderings covered | Additional real-provider timing runs; arbitrary timing is less reproducible than the controlled barrier |
| Two asks reach the final quota slot | Real-SQL tests and live 201 + 429; one reservation/saved answer/charge; original budget restored | Long-running load and actual timed month transition |
| Cross-team documents, originals, chats and sources | Database/API tests, live HR checks and new reverse Engineering checks; old/new role boundaries enforced | Broader fuzzing and a full endpoint/browser matrix |
| Document text tries to trick the assistant | Controlled provider-input spy and fabricated-label rejection; one final actual malicious source reached the real model and yielded grounded SAFE-415 without the injected marker or hidden Salary Plan source | A broad multilingual/adversarial corpus; one safe result does not establish immunity |
| Old chat references a newly restricted/deleted document | Real-PG cited/uncited provenance cases and real Salary Plan/handbook revocation; answer/citation/download/feedback/replay protected | Already delivered screenshots/bytes cannot be recalled |

Controlled AI/Storage adapters make specific failures and concurrency orderings reproducible. They do not make PostgreSQL fake. Conversely, a real model producing one correct answer is not evidence of comprehensive model safety.

## Remaining tests, in a practical order

| Priority / ID | Pending verification | Meaningful pass evidence |
| --- | --- | --- |
| Completed / R01 | Two real parallel uploads | Final run passed Hina/Sara simultaneous uploads, both Ready in 6.797 seconds total, distinct IDs, byte-matching originals and nonduplicated chunks; larger load remains separate |
| Partial extension / R02 | Real malicious document instruction | Final single synthetic real-model probe passed: expected SAFE-415, no injected instruction marker, hidden Salary Plan source absent. Broad adversarial corpus remains pending |
| P1 / R03 | Real Redis interruption and recovery | SQL intent survives an intentional queue outage; after recovery the actual worker processes once; only a dedicated test service/fixture is interrupted |
| P1 / R04 | Real-provider deletion/revocation during generation | Record operation ordering, gate decision, no unauthorized delivered/saved answer and correct quota release; preserve the deterministic barrier tests as primary race proof |
| P2 / R05 | Hosted Storage PUT/finalization/late-write faults | Actual orphan canary becomes unreadable immediately and is physically reconciled/purged; no learner original is touched |
| P2 / R06 | Automated live authenticated browser matrix | Separate real account sessions; team switch, upload, citation, feedback, admin, logout and revoked-state refresh on desktop/mobile |
| P2 / R07 | Larger corpus, sustained concurrency and free-tier failure behavior | Measured latency/throughput, bounded memory and rows; safe provider timeout/429 recovery; no quota overrun |
| P2 / R08 | Backup and restore drill | Restore a dedicated copy and verify schema, source relationships, authorization, provenance and usage without overwriting the working demo |
| P2 / R09 | Actual timed UTC rollover and restart boundaries | Observe reservations across a true period transition and settlement into the original period; prior-period fixture coverage already passed |
| P3 / R10 | Real-world PDF/malware, deployment and independent review | Dedicated safe corpus/OS isolation, TLS/ingress/distributed limits/monitoring/retention, restore procedures and independent security review |

R01 and one R02 probe were run after the learner explicitly requested completion of remaining tests and the final report. R03/R04 and broader R02 evaluation remain useful extensions. Pending does not mean the implemented rule has no test: the coverage above states what passed. Do not stop shared services or change the computer's clock to manufacture evidence.

## Final learner and agent evidence: 2026-11-23

`manual-test-observations.json` records 11 unique learner screenshots and hashes. T03 visibly shows Hina's restricted Ready file; the Queued transition/no completion toast were learner-reported, and this was not the planned Sara editor screenshot. T05 used a mismatched title, so its negative search alone is not an ACL proof. T06 first used invalid UUID `03`, then showed Hina as recipient and a clipped ID; the acknowledgement did not demonstrate an Ali grant.

The agent verified the learner file against the known synthetic fixture before any provider use. The 51-check normal-process run then used the correct identity/recipient, verified Ali deny/grant/cited answer/revoke and old history/source/original/feedback/replay protection, feedback persistence, actor-matched audit, role demotion/restore, updates/historical citation/deletion, unknown-source accounting and a final-slot race. Final learner original/readers and roles were preserved, budget restored to 1,000, three new synthetic documents tombstoned with successful worker purge jobs, and seven private test chats purged. Final HR usage: 16 used, 0 held; saved answers remain charged.

Three unsuccessful runner attempts are retained: an assumed version `isCurrent` field, an incorrect `insufficient` versus actual `insufficient_sources` assertion, and missing `SET ROLE app_owner` for a read-only ledger observer. These were harness problems, not evidence of a private-data disclosure. The observer-failed attempt still saved one real charged answer; cleanup restored its grant and purged its test chat. No application authorization was weakened to obtain a pass.

## Current Engineering demonstration

`engineering-practice.md` contains copyable questions. Ahmed is Engineering admin, Sara viewer, and there is no Engineering editor. The retained synthetic handbook is ready and team-visible. The 23-check run also verified real positive feedback, same-message replay, quota visibility, admin audit access, direct viewer upload/admin denial, cross-team denial and private-chat protection. Both temporary test chats were purged; no membership role changed.

The user's new Supabase backend secret passed a private-bucket check and a real original download after API reload. Redis was started and the project worker was reloaded before Engineering processing. No database/volume reset or source-level authorization shortcut was used.

## Learner ownership and submission review

Read `learner-preparation.md`, draw the relationships, explain the ten lifecycle rules, perform the manual exercises and write reasons in your own words. The implementation was AI-assisted. `design-decisions.md` retains its proposed/adopted distinction; permission to complete modules is not independent authorship or acceptance of each product tradeoff.

Before submission: open the report and both diagrams; inspect the source ZIP; confirm private env files, generated passwords, uploaded originals and runtime data are absent. The handbook in `demo-files` is intentionally synthetic source data. The final report explicitly records what passed, what used controlled providers and what remains unverified.
