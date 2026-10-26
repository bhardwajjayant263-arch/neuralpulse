import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DMEngine } from '../engines/dms.js';
import { NeuralPulseKV } from '../clients/kv.js';
import type { MetaGraphClient } from '../clients/graph.js';
import type { GeminiFounderClient } from '../clients/gemini.js';
import type { InstagramMessagingItem } from '../types/meta.js';

describe('DMEngine', () => {
  let kv: NeuralPulseKV;
  let mockGraph: MetaGraphClient;
  let mockGemini: GeminiFounderClient;
  let engine: DMEngine;

  beforeEach(() => {
    kv = new NeuralPulseKV();
    mockGraph = {
      sendDirectMessage: vi.fn().mockResolvedValue({
        recipient_id: 'builder_123',
        message_id: 'mid_graph_response',
      }),
    } as unknown as MetaGraphClient;

    mockGemini = {
      generateDMReply: vi.fn().mockResolvedValue(
        'Check out DSPy for modular prompt optimization. Are you deploying on serverless or containers?'
      ),
    } as unknown as GeminiFounderClient;

    engine = new DMEngine({
      kv,
      graph: mockGraph,
      gemini: mockGemini,
    });
  });

  it('maintains a 5-message conversation sliding window in KV across turns', async () => {
    const userId = 'user_builder_77';

    // Turn 1
    const msg1: InstagramMessagingItem = {
      sender: { id: userId },
      recipient: { id: 'bot_id' },
      timestamp: Date.now(),
      message: { mid: 'mid_1', text: 'Hey, what vector db do you recommend?' },
    };

    const res1 = await engine.processDM(msg1);
    expect(res1.action).toBe('REPLIED');
    expect(res1.historyLength).toBe(2); // 1 user + 1 model

    // Turn 2
    const msg2: InstagramMessagingItem = {
      sender: { id: userId },
      recipient: { id: 'bot_id' },
      timestamp: Date.now(),
      message: { mid: 'mid_2', text: 'I need sub-50ms latency for RAG.' },
    };

    const res2 = await engine.processDM(msg2);
    expect(res2.action).toBe('REPLIED');
    expect(res2.historyLength).toBe(4); // 2 user + 2 model

    // Turn 3
    const msg3: InstagramMessagingItem = {
      sender: { id: userId },
      recipient: { id: 'bot_id' },
      timestamp: Date.now(),
      message: { mid: 'mid_3', text: 'What about hybrid search?' },
    };

    const res3 = await engine.processDM(msg3);
    expect(res3.action).toBe('REPLIED');
    // Window capped at MAX_DM_HISTORY_WINDOW (5)
    expect(res3.historyLength).toBe(5);

    const storedHistory = await kv.getDMHistory(userId);
    expect(storedHistory.length).toBe(5);
  });

  it('passes existing history to Gemini generation', async () => {
    const userId = 'user_builder_88';

    // Seed prior history
    await kv.appendDMHistory(userId, 'First question', 'First answer');

    const msg: InstagramMessagingItem = {
      sender: { id: userId },
      recipient: { id: 'bot_id' },
      timestamp: Date.now(),
      message: { mid: 'mid_followup', text: 'Can you elaborate?' },
    };

    await engine.processDM(msg);

    expect(mockGemini.generateDMReply).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ text: 'First question', role: 'user' }),
        expect.objectContaining({ text: 'First answer', role: 'model' }),
      ]),
      'Can you elaborate?'
    );
  });

  it('ignores echo messages from Instagram webhook', async () => {
    const echoMsg: InstagramMessagingItem = {
      sender: { id: 'user_1' },
      recipient: { id: 'bot_1' },
      timestamp: Date.now(),
      message: { mid: 'mid_echo', text: 'echo text', is_echo: true },
    };

    const res = await engine.processDM(echoMsg);
    expect(res.action).toBe('IGNORED_ECHO');
    expect(mockGraph.sendDirectMessage).not.toHaveBeenCalled();
  });

  it('ignores messages without text content', async () => {
    const nonTextMsg: InstagramMessagingItem = {
      sender: { id: 'user_1' },
      recipient: { id: 'bot_1' },
      timestamp: Date.now(),
      message: { mid: 'mid_sticker' },
    };

    const res = await engine.processDM(nonTextMsg);
    expect(res.action).toBe('NO_TEXT');
    expect(mockGraph.sendDirectMessage).not.toHaveBeenCalled();
  });
});
