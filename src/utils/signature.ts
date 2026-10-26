import crypto from 'crypto';
import { Logger } from './logger.js';

const logger = new Logger('SignatureValidator');

export interface SignatureValidationOptions {
  rawBody: string | Buffer;
  signatureHeader?: string | string[];
  appSecret: string;
}

/**
 * Validates Meta's HMAC SHA-256 signature from incoming webhook headers.
 * Uses timingSafeEqual to guard against timing analysis attacks.
 */
export function validateMetaSignature({
  rawBody,
  signatureHeader,
  appSecret,
}: SignatureValidationOptions): boolean {
  if (!signatureHeader || !appSecret) {
    logger.warn('Signature validation failed: Missing signature header or app secret');
    return false;
  }

  const rawHeader = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!rawHeader) {
    return false;
  }

  // Meta signature format: "sha256=<signature_hex>" (or legacy "sha1=<signature_hex>")
  const parts = rawHeader.split('=');
  const signatureHex = parts.length === 2 ? parts[1] : parts[0];
  const algorithm = parts.length === 2 && parts[0] === 'sha1' ? 'sha1' : 'sha256';

  try {
    const hmac = crypto.createHmac(algorithm, appSecret);
    const bodyBuffer = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
    hmac.update(bodyBuffer);
    const expectedHex = hmac.digest('hex');

    const signatureBuffer = Buffer.from(signatureHex, 'hex');
    const expectedBuffer = Buffer.from(expectedHex, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      logger.warn('Signature validation failed: Buffer length mismatch', {
        expectedLength: expectedBuffer.length,
        receivedLength: signatureBuffer.length,
      });
      return false;
    }

    const isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    if (!isValid) {
      logger.warn('Signature validation failed: Invalid hash');
    }
    return isValid;
  } catch (err) {
    logger.error('Exception during signature verification', undefined, err);
    return false;
  }
}
