import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kvClient } from '../../src/clients/kv.js';
import { getEnvConfig } from '../../src/config/env.js';

/**
 * GET /api/auth/status
 * Returns current Instagram connection status, connected account details, and token expiration.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const envConfig = getEnvConfig();

  // 1. Check dynamic OAuth session in Vercel KV
  const kvAuth = await kvClient.getInstagramAuth();

  if (kvAuth) {
    const isExpired = Date.now() > kvAuth.expires_at;
    const remainingDays = Math.max(0, Math.round((kvAuth.expires_at - Date.now()) / (1000 * 60 * 60 * 24)));

    return res.status(200).json({
      connected: !isExpired,
      source: 'kv_oauth',
      account: {
        username: kvAuth.ig_username,
        ig_user_id: kvAuth.ig_user_id,
        page_name: kvAuth.page_name,
      },
      expires_at: new Date(kvAuth.expires_at).toISOString(),
      expires_in_days: remainingDays,
      status: isExpired ? 'EXPIRED' : 'ACTIVE',
    });
  }

  // 2. Fallback check: Environment variables
  const hasEnvToken =
    envConfig.META_ACCESS_TOKEN && !envConfig.META_ACCESS_TOKEN.includes('placeholder');
  const hasEnvUserId =
    envConfig.META_IG_USER_ID && !envConfig.META_IG_USER_ID.includes('placeholder');

  if (hasEnvToken && hasEnvUserId) {
    return res.status(200).json({
      connected: true,
      source: 'env_static',
      account: {
        ig_user_id: envConfig.META_IG_USER_ID,
      },
      status: 'ACTIVE',
    });
  }

  // Not connected
  return res.status(200).json({
    connected: false,
    status: 'DISCONNECTED',
    message: 'No active Instagram session found. Visit /api/auth/login to authenticate.',
  });
}
