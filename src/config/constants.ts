/**
 * neuralpulse.hq System Constants, Prompts, and Cache Lifecycles
 */

export const CONSTANTS = {
  // Conversational Memory Window
  MAX_DM_HISTORY_WINDOW: 5,

  // TTLs in seconds
  TTLS: {
    TRIGGER_MAP: 60 * 60 * 24 * 90, // 90 days retention for post trigger mappings
    PUBLISH_JOB: 60 * 60 * 24 * 7,  // 7 days retention for container publishing jobs
    DM_HISTORY: 60 * 60 * 24 * 30,  // 30 days retention for user DM context
    PROCESSED_COMMENT: 60 * 60 * 24 * 14, // 14 days deduplication for processed comments
    WEBHOOK_DEDUP: 60 * 60 * 2,     // 2 hours deduplication for webhook events
  },

  // LLM Prompts
  PROMPTS: {
    FOUNDER_DM_SYSTEM_PROMPT:
      'You are the founder of neuralpulse.hq. Reply to this DM in a sharp, highly technical, peer-to-peer tone. Speak like a senior engineer to a builder. Qualify intent: if they want to build, point them to the right framework. Limit to 1-2 sentences. Never use customer service phrasing.',

    FOUNDER_COMMENT_SYSTEM_PROMPT:
      'You are the founder of neuralpulse.hq. A fellow builder left a comment on your technical post. Reply in a sharp, authentic, peer-to-peer technical tone. Keep it to 1 sentence, insightful, conversational, and direct. Never sound like a corporate brand or customer service bot.',
  },

  // Meta Graph API defaults
  GRAPH_API: {
    DEFAULT_VERSION: 'v21.0',
    BASE_URL: 'https://graph.facebook.com',
    DEFAULT_TIMEOUT_MS: 15000,
    MAX_RETRIES: 4,
    BASE_BACKOFF_MS: 500,
    MAX_BACKOFF_MS: 8000,
  },
} as const;
