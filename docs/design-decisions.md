# Design decisions

These are the implemented MVP rules and their engineering reasons. Database details are in [the schema catalog](database-design.md); observed outcomes and limits are in [testing](testing.md).

## Database and service boundaries

PostgreSQL with pgvector is the canonical application database. Foreign keys, transactions, row locks and forced row-level security enforce relationships, current permissions and quota accounting. Keeping vectors in the same database avoids synchronizing permissions with a second search store. SQL migrations expose these controls directly.

Supabase Auth verifies identity; private Supabase Storage holds original file bytes. Current app permissions come from PostgreSQL, not user-supplied role claims. Redis/BullMQ delivers work whose durable intent remains in PostgreSQL. API and worker logins are separate non-owner roles without BYPASSRLS. Trusted server credentials remain outside the ordinary-user access guarantee.

## Membership roles

Roles belong to team memberships, allowing Sara to be HR editor and Engineering viewer. Viewers read permitted documents and ask questions. Editors also upload and revise/delete currently readable documents. Administrators manage members, sharing and budgets.

A removed membership is terminal. Rejoining creates a new ID, preventing old grants and private chats from reviving. Role changes use current database checks immediately. The team locking gate also prevents removing/demoting the final active administrator.

## Restricted documents and administration

New uploads start restricted to their uploader. Team visibility requires current active membership; restricted visibility additionally requires an explicit unrevoked same-team grant. Visibility changes replace the reader set deliberately instead of reviving old grants.

Admin has no implicit content access or private-chat override. A trusted same-team admin can explicitly self-grant through an audited command. Blind ACL acknowledgements avoid revealing hidden/absent document identities; the intended reader's access must be checked separately.

## Versions and team transfers

Updates create immutable revisions. The old ready version continues until a newer revision completes successfully. Late older jobs cannot replace newer successful work. Historical citations retain their original revision.

Document team IDs are immutable. Moving between teams requires a new authorized upload and new sharing rules. Source deletion is a separate authorized action, preventing accidental transfer of permissions.

## Deletion and protected history

Deletion tombstones immediately, clears the current pointer, cancels processing fences and invalidates affected answers. Background purge later removes originals/chunks; access denial does not wait for remote deletion.

Every chunk supplied to the model is recorded, including uncited evidence. If any source becomes unreadable, the entire saved assistant response, citation, feedback target and replay become unavailable. This prevents a private paraphrase surviving removal of only its quotation. Already delivered bytes cannot be recalled.

## Retrieval and answer validation

Only current-ready authorized chunks enter retrieval. The model receives document text as untrusted data and has no tools. Returned citation labels are validated, and all supplied sources are checked again under the team gate before saving and delivery. Prior generated answers are not factual evidence. These controls enforce access and provenance, not universal factual accuracy or injection immunity.

## Usage and background recovery

Quota is reserved atomically and settled with a successful saved grounded answer in its original UTC month. Failed, blocked and insufficient-source attempts release holds. Scoped idempotency and attempt fences prevent duplicate charging and stale completion. The default monthly limit is 1,000 answers; application quota is separate from provider cost.

PostgreSQL jobs/outbox retain work intent if queue delivery fails. Leases, heartbeats and fencing protect retries and activation. Cleanup retries are bounded; operational retry/reindex/restore procedures remain necessary before production use.
