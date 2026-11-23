# HTTP API reference

Local base: `http://localhost:3001`. All routes except `GET /health` require `Authorization: Bearer <verified access token>`. Use JSON unless a route specifies multipart. Acting profile/membership is resolved by the backend; the caller never supplies an acting-user ID. UUID paths and strict input schemas are validated. Responses are private/no-store and carry a server-generated request ID.

`t`, `d`, `v`, `m`, `c` below stand for team, document, version, membership/message and conversation UUIDs as named in the path. A team route always resolves current active membership.

| Method and path | Input / response | Permission |
| --- | --- | --- |
| `GET /health` | HTTP-process liveness only | Public |
| `GET /me` | Current profile ID/display name | Verified identity |
| `GET /teams` | Own active memberships with current roles | Verified identity |
| `GET /teams/{t}/members` | Current and historical team roster | Admin |
| `POST /teams/{t}/members` | `{userId, role}` for an existing profile | Admin; no automatic Auth invitation |
| `PATCH /teams/{t}/members/{m}` | `{role}` | Admin; preserve last active admin |
| `DELETE /teams/{t}/members/{m}` | Terminal removal and automatic old-grant revocation | Admin; preserve last active admin |
| `GET /teams/{t}/documents?q=...&offset=0` | Up to 100 readable titles/statuses, filtered before pagination | Active readable membership |
| `POST /teams/{t}/documents` | Multipart `file`, optional `title`; queued document/version IDs | Editor/admin; restricted + uploader grant |
| `POST /teams/{t}/documents/{d}/versions` | Same multipart; immutable new revision | Editor/admin and current document read |
| `GET /teams/{t}/documents/{d}/versions` | Original-version metadata/status/failure code | Current document read |
| `GET /teams/{t}/documents/{d}/versions/{v}/download` | Private attachment bytes; backend rechecks after Storage I/O | Current document read, exact same-team version |
| `DELETE /teams/{t}/documents/{d}` | Tombstone/invalidation now; purge queued | Editor/admin and document read |
| `GET /teams/{t}/documents/{d}/readers` | Active explicit reader membership IDs | Admin and document read |
| `POST /teams/{t}/documents/{d}/grants` | `{membershipId}`; neutral accepted acknowledgement | Admin; explicit same-team active membership |
| `DELETE /teams/{t}/documents/{d}/grants/{m}` | Neutral accepted acknowledgement | Admin |
| `PATCH /teams/{t}/documents/{d}/visibility` | `{visibility: 'team'|'restricted', readers: [...]}` | Admin; replaces explicit readers; hidden/absent targets neutral |
| `GET /teams/{t}/conversations` | Own membership's undeleted conversations | Active membership |
| `POST /teams/{t}/conversations` | New private conversation | Active membership |
| `GET /teams/{t}/conversations/{c}/messages` | Own history; unavailable assistant placeholders contain no answer/citation/title | Original active owner membership |
| `POST /teams/{t}/conversations/{c}/messages` | `{question, idempotencyKey}`; non-streamed cited/fixed-insufficient result | Original active owner membership + quota admission |
| `DELETE /teams/{t}/conversations/{c}` | Purge private message/source/feedback text; retain opaque quota tombstones | Original active owner membership |
| `GET /teams/{t}/messages/{m}/sources/{label}` | Cited original excerpt/location; historical flag | Accessible owner assistant and all potential sources still readable |
| `PATCH /teams/{t}/messages/{m}/feedback` | `{rating: 'helpful'|'unhelpful', comment?: string}`; upsert | Accessible owner assistant |
| `GET /teams/{t}/admin/usage` | UTC monthly limit, used and held counts | Admin |
| `PATCH /teams/{t}/admin/budget` | `{limit: integer 0..1000000}`; audited update | Admin |
| `GET /teams/{t}/admin/audit` | Latest 100 permitted safe events | Admin; unreadable document targets excluded |

`userId` when adding a member identifies the target user; it never changes the caller's identity. The UI lets an admin manage existing registered profiles. Team/organization creation, Auth invitations/password reset, cross-team moves, public links and arbitrary SQL are not exposed. A controlled re-upload to another team needs source read and destination editor/admin authority and receives new document/grant identities.

## Limits and failures

Questions: 1-8,000 characters. Request key: 1-200 characters, scoped to team/owner membership; changed content with an old key gives 409. Feedback comments: at most 2,000 characters. File: 20 MiB, supported PDF or UTF-8 TXT. A source label is `S1`, `S2`, etc., not a caller-selected arbitrary chunk locator.

Malformed input -> 400; missing/invalid token -> 401; known team action not permitted -> 403; missing/unreadable resource -> neutral 404; last-admin/idempotency/expired-attempt/stale-source conflict -> 409; quota or IP rate limit -> 429; missing/unavailable external provider -> 503; malformed provider JSON/schema or fabricated citation -> 502. An answer without citations, including an omitted citations field, produces the fixed uncharged insufficient-sources reply; uncited provider text is never returned. Database/internal failures use a safe generic response. No raw provider body, SQL or connection string is returned. Blind ACL/visibility commands intentionally acknowledge hidden/missing targets identically.

Usage reservation and worker/internal commands are not public HTTP endpoints. Secrets remain server-side, and direct private-bucket access remains denied to ordinary tokens. Exact failure messages and request IDs are operational clues, not authorization tokens.
