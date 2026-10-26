# neuralpulse.hq - Production AI Infrastructure Backend

Production-ready Node.js / TypeScript backend for **neuralpulse.hq** deployed on **Vercel Serverless Functions** with **Vercel KV (Upstash Redis)** and **Google Generative AI (Gemini)**.

---

## ⚡ System Architecture Highlights

```
                                      ┌─────────────────────────────────────┐
                                      │           Instagram / Meta          │
                                      │      Graph API & Webhook Stream     │
                                      └──────────────────┬──────────────────┘
                                                         │
                                    HMAC SHA-256 Webhook │
                                                         ▼
                                      ┌─────────────────────────────────────┐
                                      │          api/webhook.ts             │
                                      │   (Signature Verify & Event Router) │
                                      └──────────┬────────────────┬─────────┘
                                                 │                │
                             changes.comments    │                │ messaging
                                                 ▼                ▼
                     ┌─────────────────────────────┐    ┌─────────────────────────────┐
                     │    DynamicCommentEngine     │    │          DMEngine           │
                     │  (src/engines/comments.ts)  │    │    (src/engines/dms.ts)     │
                     └──────────────┬──────────────┘    └──────────────┬──────────────┘
                                    │                                  │
                    Query Post Map  │                                  │ Sliding 5-Message Window
                                    ▼                                  ▼
                     ┌─────────────────────────────┐    ┌─────────────────────────────┐
                     │     Vercel KV (Redis)       │    │     Vercel KV (Redis)       │
                     │   trigger_map:${media_id}   │    │    dm_history:${user_id}    │
                     └──────────────┬──────────────┘    └──────────────┬──────────────┘
                                    │                                  │
                   No Trigger Match │                                  │ Founder Persona Multi-Turn
                                    ▼                                  ▼
                     ┌─────────────────────────────┐    ┌─────────────────────────────┐
                     │   @google/generative-ai     │    │   @google/generative-ai     │
                     │    (Gemini Fallback)        │    │    (Gemini 2.5 Flash)       │
                     └─────────────────────────────┘    └─────────────────────────────┘
```

---

## 🚀 Key Features

1. **Asynchronous Daily Publisher & State Manager (`api/publish.ts` & `api/publish-status.ts`)**:
   - **Post-Specific Trigger Mapping**: Accepts post content alongside `trigger_config` (trigger keyword, DM resource, and comment reply).
   - **Two-Step Async Publishing**: Initiates Meta container rendering and returns a polling ticket, avoiding Vercel serverless execution timeouts during Meta's video rendering pipeline.
   - **State Persistence**: Persists `trigger_map:${media_id}` in Vercel KV once published.

2. **Secure Webhook & Event Router (`api/webhook.ts`)**:
   - **HMAC SHA-256 Signature Verification**: Guarded by `crypto.timingSafeEqual` with `x-hub-signature-256` / `META_APP_SECRET`.
   - **Meta Challenge Verification**: Standard handshake verification for Meta Developer App setup.
   - **Intelligent Dispatch**: Directs comment mutations to `DynamicCommentEngine` and DM events to `DMEngine`.
   - **Idempotency & Deduplication**: KV event deduplication prevents duplicate processing on Meta retries.

3. **Dynamic Comment Engine (`src/engines/comments.ts`)**:
   - **Contextual Lookup**: Queries Vercel KV for `trigger_map:${media_id}` based on the commented post.
   - **Trigger Match & Parallel Execution**: If keyword matches, instantly replies to the comment and dispatches the resource via Instagram Private DM.
   - **LLM Fallback**: If no trigger matches, invokes Gemini for an authentic, peer-to-peer technical founder response.
   - **Self-Loop Guards**: Rejects comments originating from the bot account.

4. **Intelligent DM Engine (`src/engines/dms.ts`)**:
   - **Stateful Memory**: Maintains a 5-message conversation sliding window in Vercel KV (`dm_history:${user_id}`).
   - **Builder Intellect**: Operates under the Founder persona: sharp, highly technical, peer-to-peer tone (1-2 sentences). Qualifies intent and recommends frameworks without customer service phrasing.
   - **Graph API Dispatch**: Sends response directly to the user and updates conversation memory.

5. **Infrastructure Resilience**:
   - **Exponential Backoff with Full Jitter**: Meta Graph API client automatically handles transient 429 / 5xx errors and Meta rate limit error codes (`4`, `17`, `32`, `613`).
   - **Dual KV Support**: Seamlessly works with `@vercel/kv` and `@upstash/redis` with automatic in-memory fallback for offline testing.

---

## 🛠️ Project Structure

```
neuralpulse/
├── api/
│   ├── publish.ts            # Daily publisher endpoint (Async initialization)
│   ├── publish-status.ts     # Polling status & trigger map registration
│   ├── webhook.ts            # Secure Meta Webhook router (HMAC verification)
│   └── health.ts             # Service health and telemetry
├── src/
│   ├── config/
│   │   ├── env.ts            # Zod environment schema & runtime configuration
│   │   └── constants.ts      # System prompts, TTLs, and Graph API defaults
│   ├── types/
│   │   ├── triggers.ts       # TriggerConfig & TriggerMapRecord schemas
│   │   ├── publish.ts        # PublishPayload & job status types
│   │   ├── meta.ts           # Meta Graph API and Webhook event definitions
│   │   └── kv.ts             # KV schema interfaces & conversation models
│   ├── clients/
│   │   ├── kv.ts             # Type-safe Vercel KV client with memory fallback
│   │   ├── graph.ts          # Meta Graph API client with backoff & jitter
│   │   └── gemini.ts         # Google Generative AI Founder persona client
│   ├── engines/
│   │   ├── comments.ts       # Dynamic Comment Engine (Lookup, Trigger, LLM)
│   │   └── dms.ts            # Intelligent DM Engine (Sliding memory window)
│   ├── utils/
│   │   ├── signature.ts      # Timing-safe HMAC SHA-256 validator
│   │   ├── backoff.ts        # Exponential backoff with full jitter
│   │   └── logger.ts         # Structured JSON telemetry logger
│   └── tests/
│       ├── signature.test.ts # Signature verification test suite
│       ├── backoff.test.ts   # Backoff & rate limit tests
│       ├── comments.test.ts  # Comment engine trigger & fallback tests
│       └── dms.test.ts       # DM sliding window & persona tests
├── .env.example
├── tsconfig.json
├── vercel.json
└── package.json
```

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and provide your production credentials:

```bash
# Meta / Instagram Graph API
META_APP_SECRET=your_meta_app_secret
META_VERIFY_TOKEN=your_custom_webhook_verify_token
META_ACCESS_TOKEN=your_instagram_system_user_access_token
META_IG_USER_ID=your_instagram_business_account_id
GRAPH_API_VERSION=v21.0

# Google Generative AI (Gemini)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

# Vercel KV (Upstash Redis)
# Automatically populated by Vercel when linking Vercel KV
KV_REST_API_URL=https://your-kv-store.upstash.io
KV_REST_API_TOKEN=your_kv_rest_token
```

---

## 🧪 Testing & Validation

Run unit test suites:

```bash
npm test
```

Run TypeScript compilation check:

```bash
npm run typecheck
```

---

## 📖 API Usage & Examples

### 1. Daily Publisher (`POST /api/publish`)

#### A. Publishing a Reel / Video (Asynchronous Flow):

```bash
curl -X POST https://your-deployment.vercel.app/api/publish \
  -H "Content-Type: application/json" \
  -d '{
    "media_type": "REELS",
    "video_url": "https://cdn.neuralpulse.hq/videos/dspy-architecture.mp4",
    "caption": "Why modular LM pipelines beat brittle prompt chains. Comment STACK for the source code ⚡",
    "trigger_config": {
      "word": "stack",
      "dm_message": "Here is the DSPy production repo: https://github.com/stanfordnlp/dspy",
      "comment_reply": "Sent to your DMs ⚡"
    }
  }'
```

**Response (HTTP 202 Accepted):**

```json
{
  "success": true,
  "status": "IN_PROGRESS",
  "job_id": "17841400000000000",
  "message": "Media container created and queued for rendering. Poll status endpoint to publish.",
  "check_status_url": "/api/publish-status?job_id=17841400000000000"
}
```

#### B. Polling & Publishing Container (`GET /api/publish-status?job_id=...`):

```bash
curl "https://your-deployment.vercel.app/api/publish-status?job_id=17841400000000000"
```

**Response once rendering finishes (HTTP 200 OK):**

```json
{
  "success": true,
  "status": "PUBLISHED",
  "job_id": "17841400000000000",
  "media_id": "17923456789012345",
  "trigger_config": {
    "word": "stack",
    "dm_message": "Here is the DSPy production repo: https://github.com/stanfordnlp/dspy",
    "comment_reply": "Sent to your DMs ⚡"
  },
  "message": "Media successfully published to feed and trigger mapping registered in KV."
}
```

---

### 2. Meta Webhook Handshake & Ingestion (`/api/webhook`)

- **GET `/api/webhook`**: Automatically handles `hub.challenge` verification when setting up Webhooks in Meta App Dashboard.
- **POST `/api/webhook`**: Validates `X-Hub-Signature-256` header, checks deduplication in KV, and dispatches to `DynamicCommentEngine` and `DMEngine`.

---

## 🚢 Deploying to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Link project and deploy
vercel

# Link Vercel KV store
vercel integration add upstash-redis
```

---

## 🛡️ License

MIT © [neuralpulse.hq](https://neuralpulse.hq)
