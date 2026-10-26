import type { VercelRequest, VercelResponse } from '@vercel/node';
import { PublishPayloadSchema, type PublishResponse } from '../src/types/publish.js';
import { graphClient } from '../src/clients/graph.js';
import { kvClient } from '../src/clients/kv.js';
import { Logger } from '../src/utils/logger.js';

const logger = new Logger('PublishAPI');

/**
 * POST /api/publish
 * Asynchronous Daily Publisher & State Manager.
 * Accepts content and trigger_config.
 * Uses a two-step initialization and polling architecture to avoid Vercel timeouts during video rendering.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      success: false,
      status: 'ERROR',
      message: 'Method Not Allowed. Use POST.',
    });
  }

  try {
    // 1. Validate payload schema
    const parseResult = PublishPayloadSchema.safeParse(req.body);
    if (!parseResult.success) {
      logger.warn('Invalid publish payload received', { errors: parseResult.error.format() });
      return res.status(400).json({
        success: false,
        status: 'ERROR',
        message: 'Invalid request payload',
        errors: parseResult.error.errors,
      });
    }

    const payload = parseResult.data;
    logger.info('Received publish request', {
      mediaType: payload.media_type,
      triggerWord: payload.trigger_config.word,
    });

    // 2. Create Meta Media Container
    const creationId = await graphClient.createMediaContainer({
      mediaType: payload.media_type,
      imageUrl: payload.image_url,
      videoUrl: payload.video_url,
      caption: payload.caption,
      coverUrl: payload.cover_url,
      shareToFeed: payload.share_to_feed,
    });

    const now = Date.now();

    // 3. Handle synchronous IMAGE publication vs asynchronous VIDEO/REELS rendering
    if (payload.media_type === 'IMAGE') {
      logger.info('Publishing IMAGE immediately (no video rendering phase needed)', {
        creationId,
      });

      // Images are ready immediately; publish container to live feed
      const mediaId = await graphClient.publishMedia(creationId);

      // State Storage: Save the mapping in Vercel KV using the Instagram media_id as the key
      await kvClient.setTriggerMap(mediaId, payload.trigger_config);

      // Store published job record
      await kvClient.setPublishJob(creationId, {
        creation_id: creationId,
        trigger_config: payload.trigger_config,
        status: 'PUBLISHED',
        media_type: payload.media_type,
        caption: payload.caption,
        created_at: now,
        updated_at: now,
        media_id: mediaId,
      });

      const response: PublishResponse = {
        success: true,
        status: 'PUBLISHED',
        job_id: creationId,
        media_id: mediaId,
        message: 'Image published successfully and trigger mapping persisted.',
      };

      return res.status(200).json(response);
    }

    // 4. Asynchronous Video / Reels Flow
    // Save pending publish job in Vercel KV
    await kvClient.setPublishJob(creationId, {
      creation_id: creationId,
      trigger_config: payload.trigger_config,
      status: 'IN_PROGRESS',
      media_type: payload.media_type,
      caption: payload.caption,
      created_at: now,
      updated_at: now,
    });

    logger.info('Video/Reels container creation registered in KV. Returning async polling ticket.', {
      creationId,
    });

    const response: PublishResponse = {
      success: true,
      status: 'IN_PROGRESS',
      job_id: creationId,
      message: 'Media container created and queued for rendering. Poll status endpoint to publish.',
      check_status_url: `/api/publish-status?job_id=${creationId}`,
    };

    return res.status(202).json(response);
  } catch (error: any) {
    logger.error('Unhandled error in /api/publish', undefined, error);
    return res.status(500).json({
      success: false,
      status: 'ERROR',
      message: error?.message || 'Internal Server Error during publish initialization',
    });
  }
}
