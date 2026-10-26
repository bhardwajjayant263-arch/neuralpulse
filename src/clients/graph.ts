import { CONSTANTS } from '../config/constants.js';
import { getEnvConfig } from '../config/env.js';
import { kvClient } from './kv.js';
import { withExponentialBackoff } from '../utils/backoff.js';
import { Logger } from '../utils/logger.js';
import type {
  MetaContainerResponse,
  MetaContainerStatusResponse,
  MetaMediaPublishResponse,
  MetaCommentReplyResponse,
  MetaSendDMResponse,
} from '../types/meta.js';
import type { MediaType } from '../types/publish.js';

const logger = new Logger('MetaGraphClient');

export interface CreateMediaContainerParams {
  mediaType: MediaType;
  imageUrl?: string;
  videoUrl?: string;
  caption?: string;
  coverUrl?: string;
  shareToFeed?: boolean;
}

export interface SendDMParams {
  recipientId?: string;
  commentId?: string;
  text: string;
}

export class MetaGraphClient {
  private baseUrl: string;
  private version: string;
  private accessToken: string;
  private igUserId: string;

  constructor(options?: {
    baseUrl?: string;
    version?: string;
    accessToken?: string;
    igUserId?: string;
  }) {
    const config = getEnvConfig();
    this.baseUrl = options?.baseUrl || CONSTANTS.GRAPH_API.BASE_URL;
    this.version = options?.version || config.GRAPH_API_VERSION;
    this.accessToken = options?.accessToken || config.META_ACCESS_TOKEN;
    this.igUserId = options?.igUserId || config.META_IG_USER_ID;
  }

  /**
   * Resolves token and Instagram User ID, falling back to active OAuth session in KV.
   */
  async resolveCredentials(): Promise<{ token: string; igUserId: string }> {
    if (this.accessToken && !this.accessToken.includes('placeholder')) {
      return { token: this.accessToken, igUserId: this.igUserId };
    }

    const kvAuth = await kvClient.getInstagramAuth();
    if (kvAuth && kvAuth.access_token) {
      return { token: kvAuth.access_token, igUserId: kvAuth.ig_user_id };
    }

    return { token: this.accessToken, igUserId: this.igUserId };
  }

  private getEndpointUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return `${this.baseUrl}/${this.version}/${cleanPath}`;
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'DELETE';
      params?: Record<string, string>;
      body?: Record<string, any>;
      tokenOverride?: string;
    } = {}
  ): Promise<T> {
    const creds = await this.resolveCredentials();
    const token = options.tokenOverride || creds.token;

    const url = new URL(this.getEndpointUrl(endpoint));

    // Append standard access token and query params
    url.searchParams.append('access_token', token);
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, value);
        }
      }
    }

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    let bodyStr: string | undefined;
    if (options.body) {
      headers['Content-Type'] = 'application/json';
      bodyStr = JSON.stringify(options.body);
    }

    return await withExponentialBackoff<T>(
      async () => {
        logger.debug(`Meta API Request: ${options.method || 'GET'} ${url.pathname}`, {
          endpoint,
          params: options.params,
        });

        const response = await fetch(url.toString(), {
          method: options.method || 'GET',
          headers,
          body: bodyStr,
        });

        const data: any = await response.json().catch(() => null);

        if (!response.ok) {
          const errorMessage =
            data?.error?.message || `Meta Graph API request failed with HTTP ${response.status}`;
          const err: any = new Error(errorMessage);
          err.status = response.status;
          err.metaError = data?.error;
          err.code = data?.error?.code;

          logger.error(`Meta API Error [${response.status}]`, {
            endpoint,
            error: data?.error,
          });
          throw err;
        }

        return data as T;
      },
      {
        maxRetries: CONSTANTS.GRAPH_API.MAX_RETRIES,
        baseDelayMs: CONSTANTS.GRAPH_API.BASE_BACKOFF_MS,
        maxDelayMs: CONSTANTS.GRAPH_API.MAX_BACKOFF_MS,
      }
    );
  }

  /**
   * Step 1: Create media container for Instagram post or reel.
   */
  async createMediaContainer(params: CreateMediaContainerParams): Promise<string> {
    logger.info('Creating Meta media container', { mediaType: params.mediaType });

    const queryParams: Record<string, string> = {};

    if (params.caption) {
      queryParams.caption = params.caption;
    }

    if (params.mediaType === 'IMAGE') {
      if (!params.imageUrl) throw new Error('imageUrl is required for IMAGE media_type');
      queryParams.image_url = params.imageUrl;
    } else if (params.mediaType === 'REELS' || params.mediaType === 'VIDEO') {
      if (!params.videoUrl) throw new Error('videoUrl is required for REELS/VIDEO media_type');
      queryParams.media_type = 'REELS';
      queryParams.video_url = params.videoUrl;
      if (params.coverUrl) {
        queryParams.cover_url = params.coverUrl;
      }
      if (params.shareToFeed !== undefined) {
        queryParams.share_to_feed = String(params.shareToFeed);
      }
    }

    const { igUserId } = await this.resolveCredentials();
    const res = await this.request<MetaContainerResponse>(`${igUserId}/media`, {
      method: 'POST',
      params: queryParams,
    });

    return res.id;
  }

  /**
   * Step 2: Poll container status during video/reels rendering phase.
   */
  async getContainerStatus(creationId: string): Promise<MetaContainerStatusResponse> {
    return await this.request<MetaContainerStatusResponse>(creationId, {
      method: 'GET',
      params: { fields: 'status_code,status' },
    });
  }

  /**
   * Step 3: Publish container to live Instagram feed once FINISHED.
   */
  async publishMedia(creationId: string): Promise<string> {
    logger.info('Publishing media container', { creationId });
    const { igUserId } = await this.resolveCredentials();
    const res = await this.request<MetaMediaPublishResponse>(`${igUserId}/media_publish`, {
      method: 'POST',
      params: { creation_id: creationId },
    });
    return res.id;
  }

  /**
   * Reply to an Instagram comment.
   */
  async replyToComment(commentId: string, message: string): Promise<string> {
    logger.info('Posting reply to comment', { commentId });
    const res = await this.request<MetaCommentReplyResponse>(`${commentId}/replies`, {
      method: 'POST',
      params: { message },
    });
    return res.id;
  }

  /**
   * Send a direct message to a user or as a Private Reply to a comment.
   */
  async sendDirectMessage(params: SendDMParams): Promise<MetaSendDMResponse> {
    const { recipientId, commentId, text } = params;

    let recipientPayload: Record<string, string>;
    if (commentId) {
      recipientPayload = { comment_id: commentId };
    } else if (recipientId) {
      recipientPayload = { id: recipientId };
    } else {
      throw new Error('Either recipientId or commentId must be provided to sendDirectMessage');
    }

    logger.info('Sending Direct Message via Graph API', { recipient: recipientPayload });
    const { igUserId } = await this.resolveCredentials();

    return await this.request<MetaSendDMResponse>(`${igUserId}/messages`, {
      method: 'POST',
      body: {
        recipient: recipientPayload,
        message: { text },
      },
    });
  }
}

// Singleton instance
export const graphClient = new MetaGraphClient();
