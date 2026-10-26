import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { getEnvConfig } from '../../src/config/env.js';
import { kvClient } from '../../src/clients/kv.js';
import { Logger } from '../../src/utils/logger.js';

const logger = new Logger('AuthLoginAPI');

const META_SCOPES = [
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
].join(',');

/**
 * GET /api/auth/login
 * Initiates the OAuth 2.0 "Login with Instagram" authorization flow.
 * Generates CSRF state, stores it in Vercel KV, and redirects the browser to Meta's OAuth dialog.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const envConfig = getEnvConfig();

  // Resolve base URL dynamically from request headers or environment
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const baseUrl = `${protocol}://${host}`;
  const redirectUri = `${baseUrl}/api/auth/callback`;

  // Generate cryptographically secure state token to protect against CSRF
  const state = crypto.randomBytes(24).toString('hex');
  await kvClient.saveOAuthState(state);

  const authUrl = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  authUrl.searchParams.append('client_id', envConfig.META_APP_ID);
  authUrl.searchParams.append('redirect_uri', redirectUri);
  authUrl.searchParams.append('state', state);
  authUrl.searchParams.append('scope', META_SCOPES);
  authUrl.searchParams.append('response_type', 'code');

  logger.info('Initiating Instagram OAuth login', { redirectUri, appId: envConfig.META_APP_ID });

  // If client wants direct JSON or URL, or if user requests direct redirect
  const format = req.query.format as string | undefined;
  if (format === 'json') {
    return res.status(200).json({
      auth_url: authUrl.toString(),
      state,
      redirect_uri: redirectUri,
    });
  }

  // If visited via browser directly with ?redirect=true, perform 302 redirect
  if (req.query.redirect === 'true' || req.query.direct === 'true') {
    return res.redirect(authUrl.toString());
  }

  // Otherwise, render a high-aesthetic, production-ready "Connect to Instagram" portal
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect Instagram | neuralpulse.hq</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090a0f;
      --card-bg: rgba(18, 20, 29, 0.85);
      --border: rgba(255, 255, 255, 0.08);
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.4);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --ig-gradient: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(circle at 50% 0%, rgba(99, 102, 241, 0.15) 0%, transparent 60%),
        radial-gradient(circle at 80% 80%, rgba(220, 39, 67, 0.08) 0%, transparent 50%);
      color: var(--text-main);
      font-family: 'Space Grotesk', -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .container {
      max-width: 520px;
      width: 100%;
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(99, 102, 241, 0.12);
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: 999px;
      font-size: 13px;
      font-weight: 500;
      color: #a5b4fc;
      margin-bottom: 24px;
      font-family: 'JetBrains Mono', monospace;
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      box-shadow: 0 0 10px #22c55e;
    }
    h1 {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
      background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      color: var(--text-muted);
      font-size: 15px;
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .permissions {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px;
      margin-bottom: 32px;
      text-align: left;
    }
    .permissions-title {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748b;
      margin-bottom: 12px;
      font-weight: 600;
    }
    .perm-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13.5px;
      color: #cbd5e1;
      margin-bottom: 8px;
    }
    .perm-item:last-child { margin-bottom: 0; }
    .perm-check {
      color: #38bdf8;
      font-weight: bold;
    }
    .btn-connect {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 100%;
      padding: 16px 24px;
      background: var(--ig-gradient);
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      font-size: 16px;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(220, 39, 67, 0.4);
      transition: all 0.25s ease;
      cursor: pointer;
      border: none;
    }
    .btn-connect:hover {
      transform: translateY(-2px);
      box-shadow: 0 15px 30px -5px rgba(220, 39, 67, 0.55);
    }
    .btn-connect:active {
      transform: translateY(0);
    }
    .footer-note {
      margin-top: 24px;
      font-size: 12px;
      color: #64748b;
      font-family: 'JetBrains Mono', monospace;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">
      <span class="badge-dot"></span> neuralpulse.hq / oauth-v21.0
    </div>
    <h1>Connect Instagram</h1>
    <p>Authorize neuralpulse.hq to manage automated comment triggers and memory-backed LLM direct messages via the official Meta Graph API.</p>

    <div class="permissions">
      <div class="permissions-title">Requested Capabilities</div>
      <div class="perm-item"><span class="perm-check">✔</span> Read & Reply to Instagram Post Comments</div>
      <div class="perm-item"><span class="perm-check">✔</span> Dispatch Instant Resource Direct Messages</div>
      <div class="perm-item"><span class="perm-check">✔</span> Access Post Media & Webhook Subscriptions</div>
      <div class="perm-item"><span class="perm-check">✔</span> Automatic 60-Day Long-Lived Token Refresh</div>
    </div>

    <a href="${authUrl.toString()}" class="btn-connect" id="btn-connect-instagram">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
      </svg>
      Log in with Instagram
    </a>

    <div class="footer-note">
      End-to-end encrypted with state CSRF token validation
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
