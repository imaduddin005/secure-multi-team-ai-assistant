# Free Redis for the local learning demo

Updated: 2026-11-21 (Asia/Karachi). This is an optional alternative when local Docker is unavailable. The learner's Docker engine subsequently recovered and the current demo uses **native PostgreSQL plus Compose Redis**, with a passed Redis PING and actual BullMQ delivery canary in `live-redis-setup.json`. Upstash is not configured or required for that selected local runtime. A real Redis connection remains necessary; no fake queue is substituted.

## User-owned Upstash Free database

1. Sign in at [Upstash Console](https://console.upstash.com) and create a dedicated Redis database for this demo. Stay on the Free plan. Do not add a payment method or enable a paid upgrade. Adding a payment method changes free resources to paid plans.
2. Keep eviction disabled, its documented default. Queue state must not be removed to make room for other keys. Use a dedicated database rather than sharing a cache that can evict queue records.
3. Open the database's Connect section and choose the TCP/Node.js/ioredis connection details. Copy the TLS Redis URI beginning with `rediss://`. The REST HTTPS URL and REST token do not configure BullMQ.
4. Replace only `REDIS_URL` in the existing root `.env`, preserving all other configuration:

   ```dotenv
   REDIS_URL=rediss://default:YOUR_ENCODED_PASSWORD@YOUR_ENDPOINT:6379
   ```

   Use the actual URI from the console, including its actual port and URL-encoded credential. Do not copy a `redis-cli` command or surrounding JavaScript quotation marks. Do not paste the URI/password into chat or browser configuration.
5. Restart the worker after saving. Keep PostgreSQL and the API running. A successful PING is a connectivity check; a real upload reaching `ready` through the running BullMQ worker is the subsequent delivery check.

At this update, the documented Free plan has 250 MB of data and 500,000 commands per month. Provider limits can change. BullMQ sends commands while idle, so stop the demo worker with Ctrl+C when not in use. There is no unlimited-free or production-availability claim.

TLS is always enabled by Upstash. The application supports `rediss://` and keeps Redis credentials server-side. Do not disable certificate verification to fix a connection error.

This is a setup recipe, not executed live-Redis evidence. Record actual connectivity, queue delivery and failure/recovery checks separately after configuration. No external database was created automatically.

Primary references: [Free pricing and upgrade behavior](https://upstash.com/pricing/redis), [BullMQ support and idle polling](https://upstash.com/docs/redis/integrations/bullmq), [TLS](https://upstash.com/docs/redis/features/security), and [default disabled eviction](https://upstash.com/docs/redis/features/eviction).
