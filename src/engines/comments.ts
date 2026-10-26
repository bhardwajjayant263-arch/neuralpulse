import { kvClient, type NeuralPulseKV } from '../clients/kv.js';
import { graphClient, type MetaGraphClient } from '../clients/graph.js';
import { geminiClient, type GeminiFounderClient } from '../clients/gemini.js';
import { getEnvConfig } from '../config/env.js';
import { Logger } from '../utils/logger.js';
import type { InstagramCommentValue } from '../types/meta.js';
import type { TriggerConfig } from '../types/triggers.js';

const logger = new Logger('DynamicCommentEngine');

export interface CommentProcessingResult {
  action: 'TRIGGER_MATCH' | 'LLM_FALLBACK' | 'IGNORED_SELF' | 'ALREADY_PROCESSED' | 'SKIPPED';
  commentId: string;
  mediaId: string;
  triggerMatched?: boolean;
  replyId?: string;
  dmSent?: boolean;
}

export class DynamicCommentEngine {
  private kv: NeuralPulseKV;
  private graph: MetaGraphClient;
  private gemini: GeminiFounderClient;

  constructor(dependencies?: {
    kv?: NeuralPulseKV;
    graph?: MetaGraphClient;
    gemini?: GeminiFounderClient;
  }) {
    this.kv = dependencies?.kv || kvClient;
    this.graph = dependencies?.graph || graphClient;
    this.gemini = dependencies?.gemini || geminiClient;
  }

  /**
   * Evaluates if comment text contains the trigger keyword (case-insensitive word boundary match).
   */
  private matchesTriggerWord(text: string, word: string): boolean {
    if (!text || !word) return false;
    const cleanWord = word.trim().toLowerCase();
    // Escape regex special chars in trigger word
    const escaped = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(^|\\s|[^a-zA-Z0-9])${escaped}($|\\s|[^a-zA-Z0-9])`, 'i');
    return regex.test(text.toLowerCase());
  }

  /**
   * Main entrypoint for processing an incoming Instagram comment.
   */
  async processComment(comment: InstagramCommentValue): Promise<CommentProcessingResult> {
    const commentId = comment.id;
    const mediaId = comment.media?.id;
    const commenterId = comment.from?.id;
    const commenterUsername = comment.from?.username || commenterId;
    const commentText = comment.text || '';

    logger.info('Processing incoming comment', {
      commentId,
      mediaId,
      commenterId,
      commenterUsername,
      text: commentText,
    });

    const config = getEnvConfig();

    // Guard 1: Prevent replying to our own comments (avoids infinite loops)
    if (commenterId && commenterId === config.META_IG_USER_ID) {
      logger.info('Ignoring comment from bot account', { commenterId });
      return {
        action: 'IGNORED_SELF',
        commentId,
        mediaId: mediaId || '',
      };
    }

    // Guard 2: Prevent duplicate processing of the same comment event
    if (await this.kv.isCommentProcessed(commentId)) {
      logger.info('Comment already processed. Skipping duplicate.', { commentId });
      return {
        action: 'ALREADY_PROCESSED',
        commentId,
        mediaId: mediaId || '',
      };
    }

    // Mark as processed early to avoid race conditions from Meta duplicate webhooks
    await this.kv.markCommentProcessed(commentId);

    // Step 1: Contextual Lookup - Query Vercel KV for post-specific trigger mapping
    let triggerConfig: TriggerConfig | null = null;
    if (mediaId) {
      triggerConfig = await this.kv.getTriggerMap(mediaId);
    }

    // Step 2: Trigger Execution vs LLM Fallback
    const isMatched =
      triggerConfig && this.matchesTriggerWord(commentText, triggerConfig.word);

    if (triggerConfig && isMatched) {
      logger.info('Trigger word matched! Executing instant comment reply and DM dispatch', {
        commentId,
        mediaId,
        word: triggerConfig.word,
      });

      // Execute comment reply AND DM dispatch
      let replyId: string | undefined;
      let dmSent = false;

      try {
        // 1. Reply to comment
        replyId = await this.graph.replyToComment(commentId, triggerConfig.comment_reply);
      } catch (err) {
        logger.error('Failed to post trigger comment reply', { commentId }, err);
      }

      try {
        // 2. Send resource via DM
        // Instagram Private Replies allows replying to a comment using comment_id
        await this.graph.sendDirectMessage({
          commentId,
          recipientId: commenterId,
          text: triggerConfig.dm_message,
        });
        dmSent = true;
      } catch (err) {
        logger.error('Failed to send trigger DM', { commenterId, commentId }, err);
      }

      return {
        action: 'TRIGGER_MATCH',
        commentId,
        mediaId: mediaId || '',
        triggerMatched: true,
        replyId,
        dmSent,
      };
    }

    // Step 3: LLM Fallback - No trigger word mapped or matched
    logger.info('No trigger matched. Routing to Gemini for contextual founder reply', {
      commentId,
      mediaId,
      commentText,
    });

    try {
      const aiReply = await this.gemini.generateCommentReply(commentText);
      const replyId = await this.graph.replyToComment(commentId, aiReply);

      logger.info('Posted Gemini founder reply to comment', { commentId, replyId });

      return {
        action: 'LLM_FALLBACK',
        commentId,
        mediaId: mediaId || '',
        triggerMatched: false,
        replyId,
      };
    } catch (err) {
      logger.error('Failed in LLM fallback comment handling', { commentId }, err);
      return {
        action: 'SKIPPED',
        commentId,
        mediaId: mediaId || '',
        triggerMatched: false,
      };
    }
  }
}

// Singleton instance
export const dynamicCommentEngine = new DynamicCommentEngine();
