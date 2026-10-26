import { z } from 'zod';
import dotenv from 'dotenv';

// Load .env locally if present
dotenv.config();

const envSchema = z.object({
  // Meta Configuration
  META_APP_SECRET: z.string().default('placeholder_secret_for_dev'),
  META_VERIFY_TOKEN: z.string().default('neuralpulse_verify_token'),
  META_ACCESS_TOKEN: z.string().default('placeholder_access_token'),
  META_IG_USER_ID: z.string().default('placeholder_ig_user_id'),
  GRAPH_API_VERSION: z.string().default('v21.0'),

  // Gemini Generative AI Configuration
  GEMINI_API_KEY: z.string().default('placeholder_gemini_api_key'),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),

  // Vercel KV / Upstash Redis Configuration
  KV_REST_API_URL: z.string().optional(),
  KV_REST_API_TOKEN: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type EnvConfig = z.infer<typeof envSchema>;

let cachedConfig: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errorDetails = result.error.format();
    console.error('[Config Error] Invalid environment configuration:', JSON.stringify(errorDetails, null, 2));
    throw new Error('Invalid environment configuration');
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export function resetConfigForTesting(): void {
  cachedConfig = null;
}
