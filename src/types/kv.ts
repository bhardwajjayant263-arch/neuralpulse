import type { TriggerConfig } from './triggers.js';
import type { PublishJobRecord } from './publish.js';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export type ConversationWindow = ChatMessage[];

/**
 * Standardized KV Keys across neuralpulse.hq
 */
export const KV_KEY_PREFIX = {
  TRIGGER_MAP: (mediaId: string) => `trigger_map:${mediaId}`,
  PUBLISH_JOB: (creationId: string) => `publish_job:${creationId}`,
  DM_HISTORY: (userId: string) => `dm_history:${userId}`,
  PROCESSED_COMMENT: (commentId: string) => `comment_processed:${commentId}`,
  WEBHOOK_DEDUP: (eventId: string) => `webhook_dedup:${eventId}`,
} as const;

export interface IKVStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: { ex?: number }): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
