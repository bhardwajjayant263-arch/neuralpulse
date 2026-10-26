import { Redis } from '@upstash/redis';
import { CONSTANTS } from '../config/constants.js';
import { KV_KEY_PREFIX, type ChatMessage, type IKVStore } from '../types/kv.js';
import type { TriggerConfig } from '../types/triggers.js';
import type { PublishJobRecord } from '../types/publish.js';
import type { InstagramAuthRecord } from '../types/auth.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('KVClient');

/**
 * In-memory fallback for local development or testing when KV credentials are not set.
 */
class MemoryKVStore implements IKVStore {
  private store = new Map<string, { value: any; expiresAt?: number }>();

  async get<T>(key: string): Promise<T | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value as T;
  }

  async set<T>(key: string, value: T, options?: { ex?: number }): Promise<void> {
    const expiresAt = options?.ex ? Date.now() + options.ex * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== null;
  }
}

/**
 * Upstash/Vercel KV Store implementation.
 */
class UpstashKVStore implements IKVStore {
  private redis: Redis;

  constructor(url: string, token: string) {
    this.redis = new Redis({
      url,
      token,
    });
  }

  async get<T>(key: string): Promise<T | null> {
    return await this.redis.get<T>(key);
  }

  async set<T>(key: string, value: T, options?: { ex?: number }): Promise<void> {
    if (options?.ex) {
      await this.redis.set(key, value, { ex: options.ex });
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const count = await this.redis.exists(key);
    return count > 0;
  }
}

export class NeuralPulseKV {
  private store: IKVStore;

  constructor(customStore?: IKVStore) {
    if (customStore) {
      this.store = customStore;
      return;
    }

    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token && !url.includes('placeholder')) {
      logger.info('Initializing production Upstash/Vercel KV store');
      this.store = new UpstashKVStore(url, token);
    } else {
      logger.warn('KV credentials missing or in test mode. Falling back to in-memory KV store.');
      this.store = new MemoryKVStore();
    }
  }

  /**
   * Post Trigger Mappings: `trigger_map:${media_id}`
   */
  async getTriggerMap(mediaId: string): Promise<TriggerConfig | null> {
    const key = KV_KEY_PREFIX.TRIGGER_MAP(mediaId);
    return await this.store.get<TriggerConfig>(key);
  }

  async setTriggerMap(mediaId: string, config: TriggerConfig): Promise<void> {
    const key = KV_KEY_PREFIX.TRIGGER_MAP(mediaId);
    await this.store.set(key, config, { ex: CONSTANTS.TTLS.TRIGGER_MAP });
    logger.info('Saved trigger mapping for media', { mediaId, word: config.word });
  }

  /**
   * Async Publishing Jobs: `publish_job:${creation_id}`
   */
  async getPublishJob(creationId: string): Promise<PublishJobRecord | null> {
    const key = KV_KEY_PREFIX.PUBLISH_JOB(creationId);
    return await this.store.get<PublishJobRecord>(key);
  }

  async setPublishJob(creationId: string, job: PublishJobRecord): Promise<void> {
    const key = KV_KEY_PREFIX.PUBLISH_JOB(creationId);
    await this.store.set(key, job, { ex: CONSTANTS.TTLS.PUBLISH_JOB });
  }

  /**
   * DM Conversational History: `dm_history:${userId}`
   * Maintains a 5-message conversation window.
   */
  async getDMHistory(userId: string): Promise<ChatMessage[]> {
    const key = KV_KEY_PREFIX.DM_HISTORY(userId);
    const history = await this.store.get<ChatMessage[]>(key);
    return history || [];
  }

  async appendDMHistory(
    userId: string,
    userMessage: string,
    modelReply: string
  ): Promise<ChatMessage[]> {
    const key = KV_KEY_PREFIX.DM_HISTORY(userId);
    const existing = (await this.store.get<ChatMessage[]>(key)) || [];

    const now = Date.now();
    const updated: ChatMessage[] = [
      ...existing,
      { role: 'user', text: userMessage, timestamp: now },
      { role: 'model', text: modelReply, timestamp: now + 1 },
    ];

    // Maintain exactly 5 most recent messages
    const trimmed = updated.slice(-CONSTANTS.MAX_DM_HISTORY_WINDOW);

    await this.store.set(key, trimmed, { ex: CONSTANTS.TTLS.DM_HISTORY });
    return trimmed;
  }

  /**
   * Comment Deduplication: `comment_processed:${commentId}`
   */
  async isCommentProcessed(commentId: string): Promise<boolean> {
    const key = KV_KEY_PREFIX.PROCESSED_COMMENT(commentId);
    return await this.store.exists(key);
  }

  async markCommentProcessed(commentId: string): Promise<void> {
    const key = KV_KEY_PREFIX.PROCESSED_COMMENT(commentId);
    await this.store.set(key, true, { ex: CONSTANTS.TTLS.PROCESSED_COMMENT });
  }

  /**
   * Webhook Event Deduplication: `webhook_dedup:${eventId}`
   */
  async isDuplicateWebhook(eventId: string): Promise<boolean> {
    const key = KV_KEY_PREFIX.WEBHOOK_DEDUP(eventId);
    const exists = await this.store.exists(key);
    if (!exists) {
      await this.store.set(key, true, { ex: CONSTANTS.TTLS.WEBHOOK_DEDUP });
      return false;
    }
    return true;
  }

  /**
   * OAuth CSRF State Management
   */
  async saveOAuthState(state: string): Promise<void> {
    const key = KV_KEY_PREFIX.OAUTH_STATE(state);
    // 15-minute TTL for OAuth authorization window
    await this.store.set(key, true, { ex: 60 * 15 });
  }

  async verifyAndConsumeOAuthState(state: string): Promise<boolean> {
    const key = KV_KEY_PREFIX.OAUTH_STATE(state);
    const exists = await this.store.exists(key);
    if (exists) {
      await this.store.del(key);
      return true;
    }
    return false;
  }

  /**
   * Active Instagram OAuth Session: `instagram_auth:active`
   */
  async saveInstagramAuth(record: InstagramAuthRecord): Promise<void> {
    // Retain for 60 days (or calculated until token expiry)
    const ttlSeconds = Math.max(
      60 * 60 * 24,
      Math.floor((record.expires_at - Date.now()) / 1000)
    );
    await this.store.set(KV_KEY_PREFIX.INSTAGRAM_AUTH, record, { ex: ttlSeconds });
    logger.info('Saved active Instagram OAuth session to KV', {
      username: record.ig_username,
      igUserId: record.ig_user_id,
    });
  }

  async getInstagramAuth(): Promise<InstagramAuthRecord | null> {
    return await this.store.get<InstagramAuthRecord>(KV_KEY_PREFIX.INSTAGRAM_AUTH);
  }

  async clearInstagramAuth(): Promise<void> {
    await this.store.del(KV_KEY_PREFIX.INSTAGRAM_AUTH);
  }
}

// Singleton instance
export const kvClient = new NeuralPulseKV();
