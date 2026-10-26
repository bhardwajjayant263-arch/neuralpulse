import { describe, it, expect, vi, beforeEach } from 'vitest';
import loginHandler from '../../api/auth/login.js';
import callbackHandler from '../../api/auth/callback.js';
import statusHandler from '../../api/auth/status.js';
import { kvClient } from '../clients/kv.js';
import { getEnvConfig } from '../config/env.js';

function createMockHttp(options: {
  method?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}) {
  const req: any = {
    method: options.method || 'GET',
    query: options.query || {},
    headers: options.headers || { host: 'neuralpulse.hq' },
  };

  const res: any = {
    statusCode: 200,
    headers: {},
    data: null,
    redirectUrl: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: any) {
      this.data = body;
      return this;
    },
    send(body: any) {
      this.data = body;
      return this;
    },
    redirect(url: string) {
      this.redirectUrl = url;
      return this;
    },
    setHeader(name: string, value: any) {
      this.headers[name] = value;
      return this;
    },
  };

  return { req, res };
}

describe('Instagram OAuth 2.0 Flow Tests', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await kvClient.clearInstagramAuth();
  });

  // ---------------------------------------------------------------------------
  // 1. /api/auth/login
  // ---------------------------------------------------------------------------
  describe('GET /api/auth/login', () => {
    it('generates CSRF state and returns branded connect HTML page', async () => {
      const { req, res } = createMockHttp({ method: 'GET' });
      await loginHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toContain('text/html');
      expect(res.data).toContain('Connect Instagram');
      expect(res.data).toContain('Log in with Instagram');
      expect(res.data).toContain('instagram_manage_comments');
    });

    it('returns JSON auth URL and stores state in KV when format=json', async () => {
      const { req, res } = createMockHttp({ method: 'GET', query: { format: 'json' } });
      await loginHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.auth_url).toContain('https://www.facebook.com/v21.0/dialog/oauth');
      expect(res.data.state).toBeDefined();

      // Verify CSRF state is stored in KV
      const isValidState = await kvClient.verifyAndConsumeOAuthState(res.data.state);
      expect(isValidState).toBe(true);
    });

    it('redirects directly when redirect=true is passed', async () => {
      const { req, res } = createMockHttp({ method: 'GET', query: { redirect: 'true' } });
      await loginHandler(req, res);

      expect(res.redirectUrl).toContain('https://www.facebook.com/v21.0/dialog/oauth');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. /api/auth/callback
  // ---------------------------------------------------------------------------
  describe('GET /api/auth/callback', () => {
    it('rejects missing state or code with 400', async () => {
      const { req, res } = createMockHttp({ method: 'GET', query: {} });
      await callbackHandler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.data).toContain('Missing code or state parameter');
    });

    it('rejects invalid or expired CSRF state with 403', async () => {
      const { req, res } = createMockHttp({
        method: 'GET',
        query: { code: 'valid_code', state: 'unregistered_state_token' },
      });
      await callbackHandler(req, res);

      expect(res.statusCode).toBe(403);
      expect(res.data).toContain('CSRF Security Validation Failed');
    });

    it('exchanges code, retrieves long-lived token, discovers account, and saves to KV', async () => {
      const validState = 'state_valid_999';
      await kvClient.saveOAuthState(validState);

      // Mock Meta OAuth and Graph API calls
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = url.toString();

        // 1. Short-lived token exchange
        if (urlStr.includes('oauth/access_token') && !urlStr.includes('fb_exchange_token')) {
          return {
            ok: true,
            json: async () => ({ access_token: 'short_lived_token_123', token_type: 'bearer' }),
          } as any;
        }

        // 2. Long-lived token exchange
        if (urlStr.includes('fb_exchange_token')) {
          return {
            ok: true,
            json: async () => ({
              access_token: 'long_lived_token_60_days_456',
              token_type: 'bearer',
              expires_in: 5184000, // 60 days
            }),
          } as any;
        }

        // 3. /me/accounts discovery
        if (urlStr.includes('/me/accounts')) {
          return {
            ok: true,
            json: async () => ({
              data: [
                {
                  id: 'page_12345',
                  name: 'NeuralPulse HQ Page',
                  access_token: 'page_access_token_789',
                  instagram_business_account: {
                    id: '17841499999999999',
                    username: 'neuralpulse.hq',
                    name: 'NeuralPulse HQ',
                  },
                },
              ],
            }),
          } as any;
        }

        return { ok: false, json: async () => ({}) } as any;
      });

      const { req, res } = createMockHttp({
        method: 'GET',
        query: { code: 'auth_code_from_meta', state: validState },
      });

      await callbackHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.data).toContain('Connected to Instagram!');
      expect(res.data).toContain('@neuralpulse.hq');
      expect(res.data).toContain('17841499999999999');

      // Verify active session was saved in Vercel KV
      const storedAuth = await kvClient.getInstagramAuth();
      expect(storedAuth).not.toBeNull();
      expect(storedAuth?.ig_username).toBe('neuralpulse.hq');
      expect(storedAuth?.ig_user_id).toBe('17841499999999999');
      expect(storedAuth?.access_token).toBe('page_access_token_789');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. /api/auth/status
  // ---------------------------------------------------------------------------
  describe('GET /api/auth/status', () => {
    it('returns DISCONNECTED when no session is present', async () => {
      const { req, res } = createMockHttp({ method: 'GET' });
      await statusHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.connected).toBe(false);
      expect(res.data.status).toBe('DISCONNECTED');
    });

    it('returns ACTIVE and account details when session is stored in KV', async () => {
      await kvClient.saveInstagramAuth({
        ig_user_id: '17841488888888888',
        ig_username: 'neuralpulse.builder',
        page_id: 'page_999',
        page_name: 'NeuralPulse Tech',
        access_token: 'token_live_123',
        token_type: 'bearer',
        expires_at: Date.now() + 1000 * 60 * 60 * 24 * 45, // 45 days
        connected_at: Date.now(),
      });

      const { req, res } = createMockHttp({ method: 'GET' });
      await statusHandler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.data.connected).toBe(true);
      expect(res.data.status).toBe('ACTIVE');
      expect(res.data.account.username).toBe('neuralpulse.builder');
      expect(res.data.account.ig_user_id).toBe('17841488888888888');
      expect(res.data.expires_in_days).toBeGreaterThan(40);
    });
  });
});
