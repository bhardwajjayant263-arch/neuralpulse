import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getEnvConfig } from '../src/config/env.js';
import { kvClient } from '../src/clients/kv.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const config = getEnvConfig();

    // Verify KV connection with a quick ping
    const testKey = 'health_check_ping';
    await kvClient.setTriggerMap(testKey, {
      word: 'ping',
      dm_message: 'pong',
      comment_reply: 'pong',
    });
    const retrieved = await kvClient.getTriggerMap(testKey);
    const kvHealthy = retrieved?.word === 'ping';

    return res.status(200).json({
      status: 'healthy',
      service: 'neuralpulse.hq-backend',
      environment: config.NODE_ENV,
      meta_api_version: config.GRAPH_API_VERSION,
      gemini_model: config.GEMINI_MODEL,
      kv_status: kvHealthy ? 'connected' : 'error',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({
      status: 'unhealthy',
      error: err?.message || 'Health check failed',
      timestamp: new Date().toISOString(),
    });
  }
}
