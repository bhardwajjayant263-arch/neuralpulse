import { GoogleGenerativeAI } from '@google/generative-ai';
import { CONSTANTS } from '../config/constants.js';
import { getEnvConfig } from '../config/env.js';
import type { ChatMessage } from '../types/kv.js';
import { Logger } from '../utils/logger.js';

const logger = new Logger('GeminiClient');

export class GeminiFounderClient {
  private genAI: GoogleGenerativeAI | null = null;
  private modelName: string;

  constructor(apiKey?: string, modelName?: string) {
    const config = getEnvConfig();
    const key = apiKey || config.GEMINI_API_KEY;
    this.modelName = modelName || config.GEMINI_MODEL || 'gemini-2.5-flash';

    if (key && !key.includes('placeholder')) {
      this.genAI = new GoogleGenerativeAI(key);
      logger.info('Initialized Google Generative AI with model', { model: this.modelName });
    } else {
      logger.warn('GEMINI_API_KEY is not configured or in placeholder mode. Dry-run fallback active.');
    }
  }

  /**
   * Generates a DM response maintaining conversational context and founder persona.
   */
  async generateDMReply(history: ChatMessage[], latestMessage: string): Promise<string> {
    if (!this.genAI) {
      return this.mockFounderDMReply(latestMessage);
    }

    try {
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        systemInstruction: CONSTANTS.PROMPTS.FOUNDER_DM_SYSTEM_PROMPT,
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 150,
          topP: 0.9,
        },
      });

      // Format previous messages for Gemini multi-turn chat
      // Map roles: 'user' -> 'user', 'model' -> 'model'
      const formattedHistory = history.map((msg) => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.text }],
      }));

      const chat = model.startChat({
        history: formattedHistory,
      });

      const response = await chat.sendMessage(latestMessage);
      const text = response.response.text().trim();
      return this.sanitizeOutput(text);
    } catch (err) {
      logger.error('Gemini DM generation failed. Falling back to default founder dispatch.', undefined, err);
      return this.mockFounderDMReply(latestMessage);
    }
  }

  /**
   * Generates a contextual peer-to-peer reply to an Instagram comment.
   */
  async generateCommentReply(commentText: string, mediaContext?: string): Promise<string> {
    if (!this.genAI) {
      return this.mockFounderCommentReply(commentText);
    }

    try {
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        systemInstruction: CONSTANTS.PROMPTS.FOUNDER_COMMENT_SYSTEM_PROMPT,
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 100,
          topP: 0.9,
        },
      });

      const prompt = mediaContext
        ? `Post Context: ${mediaContext}\nUser Comment: "${commentText}"\nProvide a sharp 1-sentence technical reply:`
        : `User Comment: "${commentText}"\nProvide a sharp 1-sentence technical reply:`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      return this.sanitizeOutput(text);
    } catch (err) {
      logger.error('Gemini comment reply generation failed. Using default reply.', undefined, err);
      return this.mockFounderCommentReply(commentText);
    }
  }

  private sanitizeOutput(text: string): string {
    // Strip leading and trailing quotes if the model enclosed its response in quotes
    return text.replace(/^["']|["']$/g, '').trim();
  }

  private mockFounderDMReply(userMsg: string): string {
    const lower = userMsg.toLowerCase();
    if (lower.includes('build') || lower.includes('stack') || lower.includes('agent')) {
      return 'Check out DSPy for compiling modular LM pipelines, or LangGraph for stateful graphs. What architecture are you prototyping?';
    }
    return 'Good question. If you are designing for latency and reliability, keep deterministic routing on Redis and offload reasoning to smaller distilled models.';
  }

  private mockFounderCommentReply(comment: string): string {
    return '100%—deterministic routing plus fast reasoning models is the way to scale this reliably.';
  }
}

// Singleton instance
export const geminiClient = new GeminiFounderClient();
