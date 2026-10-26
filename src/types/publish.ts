import { z } from 'zod';
import { TriggerConfigSchema, type TriggerConfig } from './triggers.js';

export const MediaTypeEnum = z.enum(['IMAGE', 'VIDEO', 'REELS']);
export type MediaType = z.infer<typeof MediaTypeEnum>;

export const PublishPayloadSchema = z.object({
  media_type: MediaTypeEnum.default('REELS'),
  image_url: z.string().url().optional(),
  video_url: z.string().url().optional(),
  caption: z.string().max(2200).optional(),
  cover_url: z.string().url().optional(),
  share_to_feed: z.boolean().default(true).optional(),
  trigger_config: TriggerConfigSchema,
}).refine(
  (data) => {
    if (data.media_type === 'IMAGE' && !data.image_url) {
      return false;
    }
    if ((data.media_type === 'VIDEO' || data.media_type === 'REELS') && !data.video_url) {
      return false;
    }
    return true;
  },
  {
    message: 'Appropriate media URL (image_url or video_url) is required for the specified media_type',
    path: ['media_type'],
  }
);

export type PublishPayload = z.infer<typeof PublishPayloadSchema>;

export type PublishJobStatus = 'IN_PROGRESS' | 'FINISHED' | 'PUBLISHED' | 'ERROR' | 'EXPIRED';

export interface PublishJobRecord {
  creation_id: string;
  trigger_config: TriggerConfig;
  status: PublishJobStatus;
  media_type: MediaType;
  caption?: string;
  created_at: number;
  updated_at: number;
  media_id?: string;
  error?: string;
}

export interface PublishResponse {
  success: boolean;
  status: PublishJobStatus;
  job_id?: string;
  media_id?: string;
  message: string;
  check_status_url?: string;
}
