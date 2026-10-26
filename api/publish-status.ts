import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kvClient } from '../src/clients/kv.js';
import { graphClient } from '../src/clients/graph.js';
import { Logger } from '../src/utils/logger.js';
import type { PublishResponse } from '../src/types/publish.js';

const logger = new Logger('PublishStatusAPI');

/**
 * GET /api/publish-status?job_id={creation_id}
 * Polls Meta container rendering status and executes publishing once ready.
 * Saves mapping in Vercel KV: `KV.set('trigger_map:${media_id}', trigger_config)`.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({
      success: false,
      status: 'ERROR',
      message: 'Method Not Allowed. Use GET or POST.',
    });
  }

  const jobId = (req.query.job_id || req.body?.job_id) as string | undefined;

  if (!jobId) {
    return res.status(400).json({
      success: false,
      status: 'ERROR',
      message: 'Missing required parameter: job_id',
    });
  }

  try {
    // 1. Retrieve job from Vercel KV
    const job = await kvClient.getPublishJob(jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        status: 'ERROR',
        message: `No publish job found for job_id: ${jobId}`,
      });
    }

    // If job was already published previously, return cached result immediately
    if (job.status === 'PUBLISHED' && job.media_id) {
      return res.status(200).json({
        success: true,
        status: 'PUBLISHED',
        job_id: jobId,
        media_id: job.media_id,
        trigger_config: job.trigger_config,
        message: 'Media already published and trigger mapping active.',
      });
    }

    logger.info('Querying Meta container rendering status', { jobId });

    // 2. Query Meta Graph API for container rendering status
    const statusResult = await graphClient.getContainerStatus(jobId);
    const statusCode = statusResult.status_code;

    logger.info('Container rendering status received', { jobId, statusCode });

    if (statusCode === 'IN_PROGRESS') {
      return res.status(200).json({
        success: true,
        status: 'IN_PROGRESS',
        job_id: jobId,
        message: 'Container is still rendering on Meta servers. Retry shortly.',
      });
    }

    if (statusCode === 'FINISHED') {
      logger.info('Rendering complete. Publishing media container to live feed...', { jobId });

      // 3. Publish container to live feed
      const mediaId = await graphClient.publishMedia(jobId);

      // 4. Save trigger mapping in Vercel KV using the Instagram media_id as key
      await kvClient.setTriggerMap(mediaId, job.trigger_config);

      // 5. Update job record in Vercel KV
      const now = Date.now();
      job.status = 'PUBLISHED';
      job.media_id = mediaId;
      job.updated_at = now;
      await kvClient.setPublishJob(jobId, job);

      logger.info('Successfully published and persisted trigger mapping in Vercel KV', {
        jobId,
        mediaId,
        triggerWord: job.trigger_config.word,
      });

      const response: PublishResponse & { trigger_config: any } = {
        success: true,
        status: 'PUBLISHED',
        job_id: jobId,
        media_id: mediaId,
        trigger_config: job.trigger_config,
        message: 'Media successfully published to feed and trigger mapping registered in KV.',
      };

      return res.status(200).json(response);
    }

    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      job.status = statusCode;
      job.updated_at = Date.now();
      job.error = statusResult.status || `Container failed with status ${statusCode}`;
      await kvClient.setPublishJob(jobId, job);

      logger.error('Meta container rendering failed', { jobId, statusCode, error: job.error });

      return res.status(422).json({
        success: false,
        status: statusCode,
        job_id: jobId,
        message: `Media container rendering failed: ${job.error}`,
      });
    }

    return res.status(200).json({
      success: true,
      status: job.status,
      job_id: jobId,
      message: `Container in status: ${statusCode}`,
    });
  } catch (error: any) {
    logger.error('Unhandled error in /api/publish-status', { jobId }, error);
    return res.status(500).json({
      success: false,
      status: 'ERROR',
      message: error?.message || 'Internal Server Error checking container status',
    });
  }
}
