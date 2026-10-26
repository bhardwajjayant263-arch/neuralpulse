import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import healthHandler from '../../api/health.js';
import publishHandler from '../../api/publish.js';
import publishStatusHandler from '../../api/publish-status.js';
import webhookHandler from '../../api/webhook.js';
import { kvClient } from '../clients/kv.js';
import { graphClient } from '../clients/graph.js';
import { getEnvConfig } from '../config/env.js';

// Helper to create mock VercelRequest and VercelResponse
function createMockHttp(options: {
  method?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: any;
  rawBody?: Buffer | string;
}) {
  const req: any = {
    method: options.method || 'GET',
    query: options.query || {},
    headers: options.headers || {},
    body: options.body || {},
    rawBody: options.rawBody,
    async *[Symbol.asyncIterator]() {
      const buffer =
        options.rawBody instanceof Buffer
          ? options.rawBody
          : Buffer.from(
              typeof options.body === 'string'
                ? options.body
                : JSON.stringify(options.body || {})
            );
      yield buffer;
    },
  };

  const res: any = {
    statusCode: 200,
    headers: {},
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.data = body;
      return this;
    },
    send(body: any) {
      this.data = body;
      return this;
    },
    setHeader(name: string, value: any) {
      this.headers[name] = value;
      return this;
    },
  };

  return { req, res };
}

describe('Serverless API Endpoints Integration Tests', () => {
  const config = getEnvConfig();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. /api/health
  // ---------------------------------------------------------------------------
  describe('GET /api/health', () => {
    it('returns healthy status and KV connectivity', async () => {
      const { req, res } = createMockHttp({ method: 'GET' });
      await healthHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.status).toBe('healthy');
      expect(res.data.kv_status).toBe('connected');
      expect(res.data.service).toBe('neuralpulse.hq-backend');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. /api/publish
  // ---------------------------------------------------------------------------
  describe('POST /api/publish', () => {
    it('rejects invalid payload with 400', async () => {
      const { req, res } = createMockHttp({
        method: 'POST',
        body: { media_type: 'IMAGE' }, // Missing image_url and trigger_config
      });

      await publishHandler(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.data.success).toBe(false);
    });

    it('synchronously publishes IMAGE and registers KV trigger mapping immediately', async () => {
      vi.spyOn(graphClient, 'createMediaContainer').mockResolvedValue('container_img_123');
      vi.spyOn(graphClient, 'publishMedia').mockResolvedValue('media_live_999');

      const { req, res } = createMockHttp({
        method: 'POST',
        body: {
          media_type: 'IMAGE',
          image_url: 'https://cdn.neuralpulse.hq/posts/architecture-diagram.png',
          caption: 'Neuralpulse infra overview. Comment STACK for the code ⚡',
          trigger_config: {
            word: 'stack',
            dm_message: 'Here is the repo: https://github.com/bhardwajjayant263-arch/neuralpulse',
            comment_reply: 'Sent to your DMs ⚡',
          },
        },
      });

      await publishHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.status).toBe('PUBLISHED');
      expect(res.data.media_id).toBe('media_live_999');

      // Verify trigger mapping in KV
      const storedTrigger = await kvClient.getTriggerMap('media_live_999');
      expect(storedTrigger).not.toBeNull();
      expect(storedTrigger?.word).toBe('stack');
    });

    it('initiates asynchronous workflow for REELS/VIDEO with 202 Accepted', async () => {
      vi.spyOn(graphClient, 'createMediaContainer').mockResolvedValue('container_reel_555');

      const { req, res } = createMockHttp({
        method: 'POST',
        body: {
          media_type: 'REELS',
          video_url: 'https://cdn.neuralpulse.hq/videos/modular-lm.mp4',
          caption: 'Why stateful agents need deterministic routing. Comment BLUEPRINT for docs ⚡',
          trigger_config: {
            word: 'blueprint',
            dm_message: 'Here is the blueprint: https://neuralpulse.hq/docs',
            comment_reply: 'Check your DMs ⚡',
          },
        },
      });

      await publishHandler(req, res);

      expect(res.statusCode).toBe(202);
      expect(res.data.status).toBe('IN_PROGRESS');
      expect(res.data.job_id).toBe('container_reel_555');
      expect(res.data.check_status_url).toBe('/api/publish-status?job_id=container_reel_555');

      // Verify job record stored in KV
      const job = await kvClient.getPublishJob('container_reel_555');
      expect(job).not.toBeNull();
      expect(job?.status).toBe('IN_PROGRESS');
      expect(job?.trigger_config.word).toBe('blueprint');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. /api/publish-status
  // ---------------------------------------------------------------------------
  describe('GET /api/publish-status', () => {
    it('returns 400 when job_id is missing', async () => {
      const { req, res } = createMockHttp({ method: 'GET', query: {} });
      await publishStatusHandler(req, res);
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when job does not exist in KV', async () => {
      const { req, res } = createMockHttp({ method: 'GET', query: { job_id: 'non_existent_job' } });
      await publishStatusHandler(req, res);
      expect(res.statusCode).toBe(404);
    });

    it('returns IN_PROGRESS while Meta video container is still rendering', async () => {
      const jobId = 'render_job_111';
      await kvClient.setPublishJob(jobId, {
        creation_id: jobId,
        trigger_config: { word: 'dspy', dm_message: 'link', comment_reply: 'reply' },
        status: 'IN_PROGRESS',
        media_type: 'REELS',
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      vi.spyOn(graphClient, 'getContainerStatus').mockResolvedValue({
        id: jobId,
        status_code: 'IN_PROGRESS',
      });

      const { req, res } = createMockHttp({ method: 'GET', query: { job_id: jobId } });
      await publishStatusHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.status).toBe('IN_PROGRESS');
    });

    it('publishes container and saves KV trigger map when Meta status is FINISHED', async () => {
      const jobId = 'render_job_222';
      await kvClient.setPublishJob(jobId, {
        creation_id: jobId,
        trigger_config: { word: 'agent', dm_message: 'Agent guide: link', comment_reply: 'Sent ⚡' },
        status: 'IN_PROGRESS',
        media_type: 'REELS',
        created_at: Date.now(),
        updated_at: Date.now(),
      });

      vi.spyOn(graphClient, 'getContainerStatus').mockResolvedValue({
        id: jobId,
        status_code: 'FINISHED',
      });
      vi.spyOn(graphClient, 'publishMedia').mockResolvedValue('media_reel_finished_777');

      const { req, res } = createMockHttp({ method: 'GET', query: { job_id: jobId } });
      await publishStatusHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.status).toBe('PUBLISHED');
      expect(res.data.media_id).toBe('media_reel_finished_777');

      // Verify trigger map is now saved in KV
      const triggerMap = await kvClient.getTriggerMap('media_reel_finished_777');
      expect(triggerMap).not.toBeNull();
      expect(triggerMap?.word).toBe('agent');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. /api/webhook
  // ---------------------------------------------------------------------------
  describe('GET & POST /api/webhook', () => {
    it('GET: verifies challenge token successfully', async () => {
      const { req, res } = createMockHttp({
        method: 'GET',
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': config.META_VERIFY_TOKEN,
          'hub.challenge': 'challenge_token_98765',
        },
      });

      await webhookHandler(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.data).toBe('challenge_token_98765');
    });

    it('GET: rejects invalid challenge token with 403', async () => {
      const { req, res } = createMockHttp({
        method: 'GET',
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong_token',
          'hub.challenge': 'challenge_123',
        },
      });

      await webhookHandler(req, res);
      expect(res.statusCode).toBe(403);
    });

    it('POST: rejects request with invalid HMAC signature', async () => {
      const rawPayload = JSON.stringify({ object: 'instagram', entry: [] });
      const { req, res } = createMockHttp({
        method: 'POST',
        headers: {
          'x-hub-signature-256': 'sha256=invalid_hash',
        },
        body: JSON.parse(rawPayload),
        rawBody: rawPayload,
      });

      await webhookHandler(req, res);
      expect(res.statusCode).toBe(403);
      expect(res.data.error).toBe('Invalid HMAC signature');
    });

    it('POST: accepts valid HMAC signature and processes comment trigger', async () => {
      const mediaId = 'media_test_post_300';
      await kvClient.setTriggerMap(mediaId, {
        word: 'scale',
        dm_message: 'Scaling guide: https://neuralpulse.hq/scale',
        comment_reply: 'Sent the scaling guide ⚡',
      });

      vi.spyOn(graphClient, 'replyToComment').mockResolvedValue('reply_id_111');
      vi.spyOn(graphClient, 'sendDirectMessage').mockResolvedValue({
        recipient_id: 'builder_99',
        message_id: 'dm_id_222',
      });

      const payload = {
        object: 'instagram',
        entry: [
          {
            id: 'entry_1',
            time: Date.now(),
            changes: [
              {
                field: 'comments',
                value: {
                  id: 'comment_scale_test',
                  text: 'How do you scale this architecture?',
                  from: { id: 'builder_99', username: 'dev_scale' },
                  media: { id: mediaId },
                },
              },
            ],
          },
        ],
      };

      const rawBody = JSON.stringify(payload);
      const signature =
        'sha256=' +
        crypto.createHmac('sha256', config.META_APP_SECRET).update(rawBody).digest('hex');

      const { req, res } = createMockHttp({
        method: 'POST',
        headers: {
          'x-hub-signature-256': signature,
        },
        body: payload,
        rawBody: rawBody,
      });

      await webhookHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.processed).toBe(1);

      // Verify Graph API actions were invoked
      expect(graphClient.replyToComment).toHaveBeenCalledWith(
        'comment_scale_test',
        'Sent the scaling guide ⚡'
      );
    });
  });
});
