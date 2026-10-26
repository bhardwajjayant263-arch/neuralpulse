import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { validateMetaSignature } from '../utils/signature.js';

describe('validateMetaSignature', () => {
  const secret = 'super_secret_meta_token_123';
  const payload = JSON.stringify({ object: 'instagram', entry: [{ id: '12345' }] });

  it('validates a correct HMAC SHA-256 signature with sha256= prefix', () => {
    const hash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const header = `sha256=${hash}`;

    const isValid = validateMetaSignature({
      rawBody: payload,
      signatureHeader: header,
      appSecret: secret,
    });

    expect(isValid).toBe(true);
  });

  it('rejects an invalid signature with tampered payload', () => {
    const hash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const header = `sha256=${hash}`;

    const isValid = validateMetaSignature({
      rawBody: '{"tampered":true}',
      signatureHeader: header,
      appSecret: secret,
    });

    expect(isValid).toBe(false);
  });

  it('rejects an incorrect secret', () => {
    const hash = crypto.createHmac('sha256', 'wrong_secret').update(payload).digest('hex');
    const header = `sha256=${hash}`;

    const isValid = validateMetaSignature({
      rawBody: payload,
      signatureHeader: header,
      appSecret: secret,
    });

    expect(isValid).toBe(false);
  });

  it('handles missing headers or secret gracefully', () => {
    expect(
      validateMetaSignature({
        rawBody: payload,
        signatureHeader: undefined,
        appSecret: secret,
      })
    ).toBe(false);

    expect(
      validateMetaSignature({
        rawBody: payload,
        signatureHeader: 'sha256=abcdef',
        appSecret: '',
      })
    ).toBe(false);
  });
});
