import { kvClient, type NeuralPulseKV } from '../clients/kv.js';
import { graphClient, type MetaGraphClient } from '../clients/graph.js';
import { geminiClient, type GeminiFounderClient } from '../clients/gemini.js';
import { getEnvConfig } from '../config/env.js';
import { Logger } from '../utils/logger.js';
import type { InstagramMessagingItem } from '../types/meta.js';
import type { ChatMessage } from '../types/kv.js';

const logger = new Logger('DMEngine');

export interface DMProcessingResult {
  action: 'REPLIED' | 'IGNORED_SELF' | 'IGNORED_ECHO' | 'NO_TEXT' | 'ALREADY_PROCESSED' | 'FAILED';
  userId: string;
  messageId?: string;
  replyText?: string;
  graphMessageId?: string;
  historyLength?: number;
}

export class DMEngine {
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
   * Main entrypoint for processing an incoming Instagram Direct Message.
   */
  async processDM(item: InstagramMessagingItem): Promise<DMProcessingResult> {
    const senderId = item.sender?.id;
    const recipientId = item.recipient?.id;
    const message = item.message;
    const mid = message?.mid;
    const text = message?.text?.trim();

    logger.info('Processing incoming DM', { senderId, recipientId, mid, text });

    const config = getEnvConfig();

    // Guard 1: Ignore echo messages from Instagram
    if (message?.is_echo) {
      logger.info('Ignoring echo message', { mid });
      return { action: 'IGNORED_ECHO', userId: senderId, messageId: mid };
    }

    // Guard 2: Ignore messages originating from our own bot account
    if (senderId === config.META_IG_USER_ID) {
      logger.info('Ignoring message from bot user ID', { senderId });
      return { action: 'IGNORED_SELF', userId: senderId, messageId: mid };
    }

    // Guard 3: Guard against non-text messages (e.g. sticker, reaction, voice note)
    if (!text) {
      logger.info('No text content in incoming DM. Skipping.', { mid });
      return { action: 'NO_TEXT', userId: senderId, messageId: mid };
    }

    // Guard 4: Prevent duplicate message execution
    if (mid && (await this.kv.isDuplicateWebhook(mid))) {
      logger.info('DM already processed. Skipping duplicate mid.', { mid });
      return { action: 'ALREADY_PROCESSED', userId: senderId, messageId: mid };
    }

    try {
      // Step 1: Stateful Memory - Retrieve recent conversation history (5-message window)
      const existingHistory: ChatMessage[] = await this.kv.getDMHistory(senderId);

      logger.info('Retrieved user conversation history', {
        userId: senderId,
        historyCount: existingHistory.length,
      });

      // Step 2: Builder Intellect - Generate response with Gemini using Founder Persona
      const aiResponse = await this.gemini.generateDMReply(existingHistory, text);

      logger.info('Generated Founder AI response', {
        userId: senderId,
        reply: aiResponse,
      });

      // Step 3: Execution - POST the AI response back via Meta Graph API
      const graphRes = await this.graph.sendDirectMessage({
        recipientId: senderId,
        text: aiResponse,
      });

      // Step 4: Update KV Store - Append user query and founder response to sliding window
      const updatedHistory = await this.kv.appendDMHistory(senderId, text, aiResponse);

      logger.info('Successfully updated conversation history in KV', {
        userId: senderId,
        windowSize: updatedHistory.length,
      });

      return {
        action: 'REPLIED',
        userId: senderId,
        messageId: mid,
        replyText: aiResponse,
        graphMessageId: graphRes.message_id,
        historyLength: updatedHistory.length,
      };
    } catch (err) {
      logger.error('Failed to process incoming DM', { senderId, mid }, err);
      return {
        action: 'FAILED',
        userId: senderId,
        messageId: mid,
      };
    }
  }
}

// Singleton instance
export const dmEngine = new DMEngine();
