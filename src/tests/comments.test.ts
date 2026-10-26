import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DynamicCommentEngine } from '../engines/comments.js';
import { NeuralPulseKV } from '../clients/kv.js';
import type { MetaGraphClient } from '../clients/graph.js';
import type { GeminiFounderClient } from '../clients/gemini.js';
import type { InstagramCommentValue } from '../types/meta.js';

describe('DynamicCommentEngine', () => {
  let kv: NeuralPulseKV;
  let mockGraph: MetaGraphClient;
  let mockGemini: GeminiFounderClient;
  let engine: DynamicCommentEngine;

  beforeEach(() => {
    kv = new NeuralPulseKV(); // Uses in-memory KV store
    mockGraph = {
      replyToComment: vi.fn().mockResolvedValue('reply_123'),
      sendDirectMessage: vi.fn().mockResolvedValue({ recipient_id: 'user_456', message_id: 'mid_789' }),
    } as unknown as MetaGraphClient;

    mockGemini = {
      generateCommentReply: vi.fn().mockResolvedValue('Deterministic routing on KV is clean architecture.'),
    } as unknown as GeminiFounderClient;

    engine = new DynamicCommentEngine({
      kv,
      graph: mockGraph,
      gemini: mockGemini,
    });
  });

  it('executes trigger reply and sends DM when trigger word matches', async () => {
    const mediaId = 'media_post_100';
    await kv.setTriggerMap(mediaId, {
      word: 'stack',
      dm_message: 'Here is the DSPy repo: https://github.com/stanfordnlp/dspy',
      comment_reply: 'Sent to your DMs ⚡',
    });

    const comment: InstagramCommentValue = {
      id: 'comment_999',
      text: 'What stack are you using here?',
      from: { id: 'builder_42', username: 'ai_engineer' },
      media: { id: mediaId },
    };

    const result = await engine.processComment(comment);

    expect(result.action).toBe('TRIGGER_MATCH');
    expect(result.triggerMatched).toBe(true);
    expect(result.dmSent).toBe(true);

    // Verify Graph API calls
    expect(mockGraph.replyToComment).toHaveBeenCalledWith('comment_999', 'Sent to your DMs ⚡');
    expect(mockGraph.sendDirectMessage).toHaveBeenCalledWith({
      commentId: 'comment_999',
      recipientId: 'builder_42',
      text: 'Here is the DSPy repo: https://github.com/stanfordnlp/dspy',
    });
  });

  it('routes to Gemini LLM fallback when comment does not match trigger word', async () => {
    const mediaId = 'media_post_200';
    await kv.setTriggerMap(mediaId, {
      word: 'blueprint',
      dm_message: 'Blueprint link',
      comment_reply: 'Sent!',
    });

    const comment: InstagramCommentValue = {
      id: 'comment_888',
      text: 'Great insights on latency optimization!',
      from: { id: 'builder_55', username: 'infra_coder' },
      media: { id: mediaId },
    };

    const result = await engine.processComment(comment);

    expect(result.action).toBe('LLM_FALLBACK');
    expect(result.triggerMatched).toBe(false);
    expect(mockGemini.generateCommentReply).toHaveBeenCalledWith('Great insights on latency optimization!');
    expect(mockGraph.replyToComment).toHaveBeenCalledWith(
      'comment_888',
      'Deterministic routing on KV is clean architecture.'
    );
    expect(mockGraph.sendDirectMessage).not.toHaveBeenCalled();
  });

  it('ignores comments posted by the bot itself', async () => {
    const comment: InstagramCommentValue = {
      id: 'comment_self',
      text: 'This is my own comment on my post',
      from: { id: 'placeholder_ig_user_id', username: 'neuralpulse.hq' },
      media: { id: 'media_100' },
    };

    const result = await engine.processComment(comment);
    expect(result.action).toBe('IGNORED_SELF');
    expect(mockGraph.replyToComment).not.toHaveBeenCalled();
  });

  it('skips duplicate comments if already processed', async () => {
    const comment: InstagramCommentValue = {
      id: 'comment_duplicate',
      text: 'stack check',
      from: { id: 'builder_1', username: 'builder' },
      media: { id: 'media_100' },
    };

    // First run
    await engine.processComment(comment);
    // Duplicate run
    const result2 = await engine.processComment(comment);

    expect(result2.action).toBe('ALREADY_PROCESSED');
  });
});
