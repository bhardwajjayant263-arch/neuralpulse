import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getEnvConfig } from '../src/config/env.js';
import { validateMetaSignature } from '../src/utils/signature.js';
import { dynamicCommentEngine } from '../src/engines/comments.js';
import { dmEngine } from '../src/engines/dms.js';
import { kvClient } from '../src/clients/kv.js';
import { Logger } from '../src/utils/logger.js';
import type { InstagramWebhookPayload } from '../src/types/meta.js';

const logger = new Logger('WebhookRouter');

// Disable Vercel's automatic body parser to preserve raw payload for HMAC SHA-256 verification
export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * Extracts the exact, untampered raw bytes from the incoming HTTP stream.
 */
async function getRawBodyBuffer(req: VercelRequest): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    return Buffer.from(req.body, 'utf8');
  }
  if ((req as any).rawBody) {
    return Buffer.isBuffer((req as any).rawBody)
      ? (req as any).rawBody
      : Buffer.from((req as any).rawBody);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Meta Webhook Router & Verification Endpoint
 * GET: Webhook subscription verification
 * POST: Event verification and routing to DynamicCommentEngine and DMEngine
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const envConfig = getEnvConfig();

  // ---------------------------------------------------------------------------
  // 1. GET: Webhook Verification Challenge from Meta App Dashboard
  // ---------------------------------------------------------------------------
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    logger.info('Meta verification handshake initiated', { mode, tokenReceived: !!token });

    if (mode === 'subscribe' && token === envConfig.META_VERIFY_TOKEN) {
      logger.info('Webhook verified successfully by Meta challenge');
      return res.status(200).send(challenge);
    }

    logger.warn('Webhook verification token mismatch', {
      expected: envConfig.META_VERIFY_TOKEN,
      received: token,
    });
    return res.status(403).send('Forbidden: Invalid verification token');
  }

  // ---------------------------------------------------------------------------
  // 2. POST: Secure Webhook Event Ingestion
  // ---------------------------------------------------------------------------
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // Read raw body stream for exact byte-for-byte HMAC validation
    const rawBuffer = await getRawBodyBuffer(req);

    // Security: Validate HMAC SHA-256 signature
    const signature =
      (req.headers['x-hub-signature-256'] as string) ||
      (req.headers['x-hub-signature'] as string);

    const isSignatureValid = validateMetaSignature({
      rawBody: rawBuffer,
      signatureHeader: signature,
      appSecret: envConfig.META_APP_SECRET,
    });

    if (!isSignatureValid) {
      logger.warn('Rejected webhook request: Invalid HMAC signature', {
        hasSignature: !!signature,
      });
      return res.status(403).json({ error: 'Invalid HMAC signature' });
    }

    const payload: InstagramWebhookPayload = JSON.parse(rawBuffer.toString('utf8'));

    logger.info('Authenticated Meta webhook payload received', {
      object: payload?.object,
      entriesCount: payload?.entry?.length || 0,
    });

    if (!payload?.entry || !Array.isArray(payload.entry)) {
      return res.status(200).json({ status: 'ignored_empty_payload' });
    }

    const tasks: Promise<any>[] = [];

    // Process each entry in the Meta batch
    for (const entry of payload.entry) {
      const entryId = entry.id;
      const entryTime = entry.time;

      // Event Deduplication per entry event
      const dedupKey = `entry_${entryId}_${entryTime}`;
      if (await kvClient.isDuplicateWebhook(dedupKey)) {
        logger.info('Duplicate webhook entry detected. Skipping.', { dedupKey });
        continue;
      }

      // Route 1: Comments Changes -> DynamicCommentEngine
      if (entry.changes && Array.isArray(entry.changes)) {
        for (const change of entry.changes) {
          if (change.field === 'comments' && change.value) {
            tasks.push(dynamicCommentEngine.processComment(change.value));
          }
        }
      }

      // Route 2: Messaging Events -> DMEngine
      if (entry.messaging && Array.isArray(entry.messaging)) {
        for (const messageItem of entry.messaging) {
          tasks.push(dmEngine.processDM(messageItem));
        }
      }
    }

    // Await all routed events within serverless function execution
    const results = await Promise.allSettled(tasks);
    logger.info('Processed webhook batch', {
      totalTasks: tasks.length,
      successes: results.filter((r) => r.status === 'fulfilled').length,
      failures: results.filter((r) => r.status === 'rejected').length,
    });

    // Always respond 200 OK to Meta to acknowledge receipt and prevent webhook retries
    return res.status(200).json({
      success: true,
      processed: tasks.length,
    });
  } catch (error: any) {
    logger.error('Critical failure in webhook handler', undefined, error);
    // Respond 200 with error flag to prevent Meta from disabling the webhook endpoint
    return res.status(200).json({
      success: false,
      error: error?.message || 'Internal processing error',
    });
  }
}
