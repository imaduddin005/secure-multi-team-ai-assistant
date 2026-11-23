# Engineering practice and current team roles

Observed: 2026-11-23, Asia/Karachi. The normal running API and real Supabase, PostgreSQL, Redis/BullMQ, Gemini and Groq passed **23/23 Engineering checks**. Exact evidence: `live-engineering-run.json`. This is authenticated HTTP evidence, not a full automated live-browser run.

## Memberships

| Person | HR | Engineering |
| --- | --- | --- |
| Ali | Viewer | No membership |
| Sara | Editor | Viewer |
| Hina | Admin | No membership |
| Ahmed | No membership | Admin |

There is currently **no Engineering editor**. An admin may upload and administer the team; a viewer may read authorized files and ask questions. A viewer cannot upload or administer. No role was changed to create this demonstration. A role belongs to a membership, not to the global user or to a claim typed in a question.

The user explicitly requested a new Sara demo password. Her existing Auth subject and local profile binding were verified, her Supabase password and only her private credential-file entry were updated, and a fresh real login returned HR editor / Engineering viewer. Sanitized evidence: `live-sara-reset.json`. The password is only in ignored `.tmp/demo-login-credentials.txt`; it is excluded from the source package. Sign out and sign in again if an old Sara session cannot refresh.

## Uploaded file

Ahmed uploaded `demo-files/TechCo Engineering Handbook.txt`. The actual worker downloaded the private original, extracted text, obtained real Gemini vectors and made the version ready. Ahmed then explicitly made it visible to the Engineering team. Sara's viewer download matched the local synthetic file byte for byte. The seeded `API Guide` was preserved; its metadata-only state is separate from the ready handbook.

The handbook's policies are **invented exercise data**. Its code-review/release/incident statements do not establish that CI, deployments or on-call operations have been implemented in this project. Uploading a policy document does not create infrastructure or grant permissions. Team visibility changes app authorization; the Supabase bucket remains private.

## Questions to copy into Engineering Chat

| English question | Expected fact from this synthetic handbook |
| --- | --- |
| According to the TechCo Engineering Handbook, how many minutes does the on-call engineer have to acknowledge a critical incident? Cite the source. | 15 minutes; live Ahmed answer/citation checked |
| According to the TechCo Engineering Handbook, how many approvals from another engineer are required before merging a pull request? Cite the source. | At least one; live Sara answer/citation checked |
| What is the normal release window in the TechCo Engineering Handbook? | Tuesday, 14:00 UTC |
| How soon should an incident summary be written after resolution? | Within 24 hours |
| How many hours per quarter can an engineer reserve for technical learning? | Six hours |
| What Authorization header format is described for authenticated API calls? | Bearer access token |

Only the first two question/answer facts were asserted against real model responses in this run. The other questions are learner exercises with known source facts, not additional claimed live passes. Each answer should have an authorized supporting citation.

## Restrictions to reproduce

1. Sign in as Ahmed and choose Engineering. Documents includes the ready handbook, upload is available and Admin is visible.
2. Sign in as Sara in an isolated browser session and choose Engineering. Read/download/ask work; upload and Admin are absent. The runner also directly called both protected actions and observed HTTP 403.
3. Sara chooses HR. Her role becomes editor, so HR upload is available; HR Admin remains absent.
4. Ali has no Engineering membership. Known document/version IDs did not bypass the live HTTP team boundary.
5. Ahmed's Engineering admin role does not permit HR document access or access to Sara's private chat.

Use a normal window and Incognito, different browser profiles, or sign out/in between accounts. Two ordinary tabs may share the same Supabase session.

## Reproduce the automated live checks

```powershell
node --env-file=.env tools/check-live-engineering.mjs --run --with-sara
```

The runner preserves an existing matching synthetic handbook and refuses to overwrite a different original. It uses actual model quota and real services, retains the practice document, purges only its own test conversations, signs out only its own sessions and verifies membership roles were preserved. It does not stop containers, rewrite quota counts or dispatch database jobs by hand.
