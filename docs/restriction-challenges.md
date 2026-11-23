# Salary Plan restrictions and simultaneous-request challenges

Use the real synthetic TechCo demo, with four separate Auth accounts. Passwords remain in the ignored private credential file. The fixed Salary Plan contains invented training credits, not real salaries.

## Who is restricted?

| Person | Membership | Salary Plan without a new grant | HR team-visible handbook |
| --- | --- | --- | --- |
| Ali | HR viewer | Denied: no explicit Salary Plan grant | Read and ask; upload remains denied |
| Sara | HR editor; Engineering viewer | Denied: editing role does not imply restricted-content read | Read/ask and permitted HR editing |
| Hina | HR admin | Allowed because the seeded Salary Plan explicitly grants Hina | Read/ask and administer access |
| Ahmed | Engineering admin; no HR membership | HR access denied; Engineering admin is not a global admin | HR document access denied |

Hina's admin role is administrative authority, not automatic content read. A new private document uploaded by Sara initially excludes Hina. A trusted HR admin who knows that document ID can explicitly grant herself access through the audited ACL command. Therefore restricted visibility is not protection against a trusted same-team ACL administrator deliberately granting access. An Engineering admin cannot perform that HR action.

## Live checks

**Observed on 2026-11-21: 46/46 checks passed**, using the real services listed below. The original attempt passed 21 access checks before an uncited Groq refusal was incorrectly returned as HTTP 400. No hidden Salary Plan value was disclosed. The adapter now normalizes an omitted citation list to the fixed uncharged insufficient-sources response; malformed provider data is HTTP 502. The subsequent 72/72 regression and complete live rerun passed. The failed attempt and diagnosis remain in `live-challenges-initial-failure.json`.

The opt-in runner is `node --env-file=.env tools/check-live-challenges.mjs --run`. It calls the normal running API with real Supabase identities, real private Storage, the actual Redis worker, Gemini and Groq. Permission changes use the public authenticated API. A separate restricted read-only observer inspects PostgreSQL ledger counters; it does not manufacture a winning result or change quota rows.

1. Provision the seeded Salary Plan only if it has no original yet; otherwise preserve and compare its original against the known synthetic fixture. Keep its restricted visibility and Hina-only reader baseline.
2. Check allowed Hina read; denied Ali/Sara search, version metadata and direct originals; denied HR access by Ahmed; unauthenticated and tampered-JWT denial; neutral hidden/nonexistent responses; blocked direct Storage reads.
3. Check that ordinary viewers/editors cannot self-grant or update a restricted file they cannot read. Ask as Ali about the hidden Salary Plan and inspect provenance to ensure the restricted document was not supplied.
4. Explicitly grant Sara, obtain an actual cited Salary Plan answer, then revoke. Recheck the original, old citation, full old answer, feedback and idempotent cached response. Hina cannot read Sara's private conversation.
5. Create a temporary Sara-only memo. Observe Hina admin's initial denial, explicit self-grant, successful read and denial again after revocation. Delete only that temporary memo.
6. Send two different HTTP questions together with quota available: both should be admitted and charged once each. Observe real used/held counts while requests run.
7. Temporarily set the monthly limit to current used count plus one. Send two questions together: one succeeds and one gets HTTP 429. Check one charge/one saved answer and no over-limit observation. Restore the original limit.
8. Send the same question/key twice together. One response may be HTTP 409 while in progress, or both may return the same completed message. PostgreSQL must show one reservation, one saved answer and one charge. A changed question with that key must get HTTP 409.

The runner removes temporary grants, restores the budget, preserves original membership roles and purges its own test conversations. Actual successful answers retain their quota charges; this is not a usage-counter reset. The synthetic Salary Plan remains ready for learner practice.

| Concurrent action | Observed HTTP results | PostgreSQL result |
| --- | --- | --- |
| Ali and Sara ask different questions with quota available | 201 + 201 | Two reservations, two saved answers, two charges; maximum observed held = 2 |
| Ali and Sara race for one remaining answer | Ali 201; Sara 429 | One reservation, one saved answer, one charge; maximum observed held = 1; no over-limit sample |
| Ali submits the same question/key twice together | 201 + 409; completed replay 201 with the same message ID | One reservation, one saved answer, one charge; changed question with the old key returned 409 |

The winner of a quota race depends on transaction ordering; Ali is not guaranteed to win a future race. There were 43 usage samples in the normal case and 25 in the last-slot case. These observations supplement transaction/ledger assertions; they are not a vendor billing/call-count measurement.

Cleanup verified all seven test conversations purged, original roles preserved, Salary Plan restored to Hina-only and the original monthly limit restored to 1,000. Final observed HR usage was 8 used / 0 held. A temporary private memo was deleted and its original immediately denied; physical remote-object deletion was not separately asserted.

## Reproduce in the UI

Keep API, worker and frontend terminals open. Sign out/in between test personas or use isolated browser sessions; never share their access tokens. Hina's Documents screen should list Salary Plan. Ali/Sara should see the handbook but not Salary Plan. In Admin, Hina can copy/use the Salary Plan document ID, select Sara's HR membership and Grant read. After Sara asks a Salary Plan question, Hina can Revoke; Sara must refresh history/citations to observe the denial.

An already displayed answer, downloaded original or screenshot cannot be recalled. The restriction governs subsequent API reads and refreshed application state. Exact live results and limitations are recorded in `live-challenges-run.json`. Use a normal browser session and an Incognito session, or sign out/in between personas; two ordinary tabs can share the same login.
