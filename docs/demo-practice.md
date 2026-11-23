# Demo practice and expected answers

Use only the invented files in `demo-files`. Never upload credentials, real personnel records or this answer sheet. The current AI setup uses Groq Free answers and Gemini Free embeddings; the Gemini free-tier data terms apply.

Current workspace: the handbook has already been uploaded, processed to `ready` and explicitly made Team-visible by Hina during the live demo checks. Click Documents > Refresh, then Chat > New conversation. Do not create another copy just to use the existing ready handbook. The upload steps below are for a fresh installation or deliberate practice. The live check's temporary Sara grant was revoked and its private conversation was purged; the handbook remains available to HR viewers.

## Upload and ask

1. Keep native PostgreSQL, Docker Redis, the API, the worker and the frontend running. The root commands are `npm run db:native:start`, `docker compose up -d redis`, and, in separate terminals, `npm run api:start`, `npm run worker:start`, `npm run web:start`.
2. Open `http://localhost:3000`, sign in as Hina and select HR. The private generated login file is under ignored `.tmp`; do not share it.
3. Under Documents, choose `demo-files/TechCo HR Handbook.txt`, set title `TechCo HR Handbook`, and click Upload. A new upload is restricted to its uploader by default. For this exercise Hina can read her own upload.
4. Click Refresh until the status is `ready`. A queued/processing document is not eligible evidence yet.
5. Open Chat, click New conversation, ask a question below and inspect the source citation.

| Question | Expected fact from the handbook |
| --- | --- |
| How many annual leave days does an employee receive? | 20 working days per calendar year |
| How much notice is needed for planned leave? | At least 5 working days |
| How many sick leave days are available? | 10 working days per calendar year |
| When is a medical certificate required? | After more than 3 consecutive working days of sick leave |
| How many remote work days are allowed each week? | Up to 2, with prior written line-manager approval |
| What are the office hours? | Monday-Friday, 09:00-18:00, including a one-hour lunch break |
| How long is probation? | 90 calendar days |
| What is the reimbursement limit and receipt deadline? | PKR 15,000 per month; receipts within 7 calendar days |

The answer should include a citation whose excerpt supports the claim. A schema-valid model response alone is not proof of factual accuracy.

## Canonical TechCo permission exercise

Use Update on the already seeded Leave Policy with `demo-files/Leave Policy.txt`, rather than creating duplicate copies. Hina updates Salary Plan with its matching sample and retains restricted access. Ahmed updates Engineering API Guide with its matching sample.

- Ali is HR viewer: team-visible HR documents are readable; upload is denied.
- Sara is HR editor and Engineering viewer: capabilities change with the selected team.
- Hina is HR admin: she can explicitly grant/revoke document access, but cannot read another member's private chat.
- Ahmed is Engineering admin and does not automatically read HR documents.
- To let Ali/Sara read the new handbook, Hina may explicitly set it to Team visibility through Admin, or grant a particular membership. Do not make Salary Plan team-visible as part of that exercise.
- After a restricted grant is revoked, an affected old assistant answer/citation must become unavailable. Admin does not bypass this rule.

The complete security, quota, failure and recovery checklist is in `live-acceptance.md`; implemented behavior and actually observed results are tracked separately.
