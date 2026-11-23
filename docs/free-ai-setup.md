# Provider setup

Configuration reference dated 2026-11-21. The demonstrated profile used Gemini embeddings at 768 dimensions and Groq JSON/cited answers on synthetic documents. Live observations and limits are summarized in testing.md. Provider credentials stay server-only; no billing upgrade is required by this recipe.

## Two real services

- Answers: Groq Free, `openai/gpt-oss-20b`, compatible endpoint `https://api.groq.com/openai/v1`.
- Embeddings: Gemini API Free Tier, `gemini-embedding-2`, compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai`, requested dimensions `768`.

Groq's model name contains `openai/` because it hosts that open-weight model; it uses a Groq key and Groq account quota. It does not require an OpenAI API key. Embeddings are still real semantic vectors, not a test-only or keyword substitute.

Create a key at [Groq Console](https://console.groq.com/keys) while staying on the Free plan. Create a separate key for a Free Tier project in [Google AI Studio](https://aistudio.google.com/apikey). Do not enable billing, upgrade plans, or add a payment method for this demo. Do not paste either key into chat, source, or browser configuration.

Update the existing root `.env` only:

```dotenv
EMBEDDING_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
EMBEDDING_MODEL=gemini-embedding-2
EMBEDDING_DIMENSIONS=768
EMBEDDING_API_KEY=YOUR_GEMINI_API_KEY

ANSWER_BASE_URL=https://api.groq.com/openai/v1
ANSWER_MODEL=openai/gpt-oss-20b
ANSWER_API_KEY=YOUR_GROQ_API_KEY
```

Each key belongs to its own provider. Existing Supabase and database credentials must be preserved. Neither key belongs in `apps/web/.env.local`. Restart the API and worker after saving server configuration. The legacy `AI_BASE_URL` remains a fallback when either separate endpoint is blank, so existing shared-endpoint installations retain their embedding profile identity.

## Limits and private data

Use only the invented files in `demo-files` with this free hosted setup. Gemini's Free Tier pricing states that submitted content can be used to improve Google's products. It is not an appropriate route for confidential HR or customer documents. Application permissions still restrict which chunks can reach either provider; they do not change the provider's data terms.

Free-tier request/token limits can return HTTP 429 or temporarily prevent processing/answers. The application's monthly answer quota is separate. There is no automatic paid-provider fallback or unlimited-use promise. Account-specific model access must be checked with the actual keys before calling this live-ready.

An embedding endpoint/model/dimension change requires a planned reindex when ready documents already exist. Changing only the answer endpoint/model does not change the embedding profile. Do not delete populated documents or reset the database to change providers.

## Verification boundary

Thirteen local HTTP/configuration cases verify separate endpoint routing, credential separation, response validation, and profile identity. Index-free arrays use input order; a single omitted zero index is recovered only when the complete indexed set is unambiguous. Conflicting or multiple missing indexes fail closed. This handles the actual Gemini response observed during setup without weakening count, dimension, finite-value or nonzero-vector checks. A real Groq refusal omitted the citations field: that case now becomes an empty citation list, so the application returns its fixed insufficient-sources reply without delivering the model's text or charging a saved-answer slot. Malformed provider JSON/citation structure is a gateway error. The full regression passed 72/72 tests in three suites, including an application/real-PostgreSQL refusal-accounting case.

Recorded live scenarios verified synthetic handbook processing/cited answers, restricted-file access and concurrent quota handling through the normal Redis worker. See [testing methods, actual outcomes and limits](testing.md). A valid JSON response and accepted citation label do not independently establish factual grounding or prompt-injection resistance.

Primary references: [Groq free limits](https://console.groq.com/docs/rate-limits), [Groq compatible endpoint](https://console.groq.com/docs/openai), [Groq JSON mode](https://console.groq.com/docs/structured-outputs), [Gemini pricing and data use](https://ai.google.dev/gemini-api/docs/pricing), [Gemini compatible embeddings](https://ai.google.dev/gemini-api/docs/openai#embeddings), and [embedding dimensions](https://ai.google.dev/gemini-api/docs/embeddings#output_dimensionality).
