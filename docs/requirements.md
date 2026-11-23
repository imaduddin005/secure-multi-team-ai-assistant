# Project requirements

## Product

One organization contains multiple teams. Each team uploads documents and has an assistant that answers from those documents with supporting citations. A person can have different roles in different teams. Documents can be team-visible or restricted to selected members.

An unauthorized person must not receive an answer, quotation, title or hint derived from a document they cannot read. Current access also governs old assistant responses and their sources.

## Design and behavior

Document the database choice, table relationships and reasons before application implementation. Define deliberate behavior for updates, deletion, team transfers, membership removal, role changes and history after source access is lost. The retained schema and decision documents describe the implemented rules.

## Backend and frontend

- Login and current team/document authorization.
- Viewer, editor and administrator memberships.
- Private uploads, processing status and background workers.
- Answers with inspectable source citations and user feedback.
- Audit records and per-team usage limits.
- Chat, Documents and Admin frontend pages.

The implementation uses Next.js, NestJS, PostgreSQL/pgvector, Supabase Auth/private Storage and BullMQ/Redis. Embedding and answer providers are configurable.

## Verification

Exercise simultaneous uploads; deletion/revocation during generation; concurrent requests competing for a final quota slot; cross-team access; and malicious document instructions. Distinguish controlled-provider checks from real-service observations. Record actual results, unresolved limits and cleanup rather than inferring a pass from a build.

## Submission

Provide runnable code and setup instructions, the final short report and database diagram. The report covers database choice/design, rules/reasons, hard-case actions/results and changes before real use. Credentials, runtime data, raw screenshots and development-review notes are excluded from the submission tree.
