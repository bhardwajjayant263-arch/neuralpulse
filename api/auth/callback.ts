import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getEnvConfig } from '../../src/config/env.js';
import { kvClient } from '../../src/clients/kv.js';
import { Logger } from '../../src/utils/logger.js';
import type {
  InstagramOAuthTokenResponse,
  MetaAccountsResponse,
  InstagramAuthRecord,
} from '../../src/types/auth.js';

const logger = new Logger('AuthCallbackAPI');

/**
 * GET /api/auth/callback
 * Handles OAuth return redirect from Meta.
 * 1. Validates CSRF state
 * 2. Exchanges code for short-lived token
 * 3. Exchanges for 60-day Long-Lived Access Token
 * 4. Auto-discovers connected Instagram Business Account
 * 5. Persists session in Vercel KV for immediate use
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const envConfig = getEnvConfig();

  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;
  const errorDescription = req.query.error_description as string | undefined;

  // Handle user denied or Meta error
  if (error) {
    logger.warn('OAuth denied or failed by user', { error, errorDescription });
    return res.status(400).send(renderErrorHtml('Authorization Denied', errorDescription || error));
  }

  if (!code || !state) {
    return res.status(400).send(renderErrorHtml('Bad Request', 'Missing code or state parameter from Meta.'));
  }

  // 1. Verify and consume CSRF state token from Vercel KV
  const isStateValid = await kvClient.verifyAndConsumeOAuthState(state);
  if (!isStateValid) {
    logger.warn('Invalid or expired OAuth CSRF state', { state });
    return res.status(403).send(renderErrorHtml('CSRF Security Validation Failed', 'The authorization state token was invalid or expired. Please initiate login again.'));
  }

  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const redirectUri = `${protocol}://${host}/api/auth/callback`;

  try {
    logger.info('Exchanging OAuth code for Access Token...');

    // 2. Exchange code for short-lived User Access Token
    const tokenUrl = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
    tokenUrl.searchParams.append('client_id', envConfig.META_APP_ID);
    tokenUrl.searchParams.append('client_secret', envConfig.META_APP_SECRET);
    tokenUrl.searchParams.append('redirect_uri', redirectUri);
    tokenUrl.searchParams.append('code', code);

    const tokenRes = await fetch(tokenUrl.toString(), { method: 'GET' });
    const tokenData: any = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      logger.error('Failed to exchange code for token', tokenData);
      return res.status(400).send(renderErrorHtml('Token Exchange Failed', tokenData.error?.message || 'Failed to exchange authorization code.'));
    }

    const shortLivedToken = tokenData.access_token;

    // 3. Exchange short-lived token for 60-Day Long-Lived Token
    logger.info('Upgrading to 60-day Long-Lived Access Token...');
    const longLivedUrl = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
    longLivedUrl.searchParams.append('grant_type', 'fb_exchange_token');
    longLivedUrl.searchParams.append('client_id', envConfig.META_APP_ID);
    longLivedUrl.searchParams.append('client_secret', envConfig.META_APP_SECRET);
    longLivedUrl.searchParams.append('fb_exchange_token', shortLivedToken);

    const longLivedRes = await fetch(longLivedUrl.toString(), { method: 'GET' });
    const longLivedData: any = await longLivedRes.json();

    const activeToken = longLivedData.access_token || shortLivedToken;
    const expiresInSeconds = longLivedData.expires_in || 60 * 60 * 24 * 60; // default 60 days
    const expiresAt = Date.now() + expiresInSeconds * 1000;

    // 4. Auto-discover linked Facebook Pages and Instagram Business Account
    logger.info('Querying Meta Graph API for connected Instagram Business accounts...');
    const accountsUrl = new URL('https://graph.facebook.com/v21.0/me/accounts');
    accountsUrl.searchParams.append('fields', 'name,access_token,instagram_business_account{id,username,name,profile_picture_url}');
    accountsUrl.searchParams.append('access_token', activeToken);

    const accountsRes = await fetch(accountsUrl.toString(), { method: 'GET' });
    const accountsData: MetaAccountsResponse = (await accountsRes.json()) as MetaAccountsResponse;

    let matchedAccount: {
      pageId: string;
      pageName: string;
      pageAccessToken: string;
      igId: string;
      igUsername: string;
    } | null = null;

    if (accountsData.data && Array.isArray(accountsData.data)) {
      for (const page of accountsData.data) {
        if (page.instagram_business_account) {
          matchedAccount = {
            pageId: page.id,
            pageName: page.name,
            pageAccessToken: page.access_token || activeToken,
            igId: page.instagram_business_account.id,
            igUsername: page.instagram_business_account.username,
          };
          break;
        }
      }
    }

    if (!matchedAccount) {
      logger.warn('No Instagram Business Account linked to the authorized Facebook Page(s)', accountsData);
      return res.status(200).send(renderNoInstagramHtml(accountsData.data || []));
    }

    // 5. Persist Instagram Auth Record in Vercel KV for immediate live use
    const authRecord: InstagramAuthRecord = {
      ig_user_id: matchedAccount.igId,
      ig_username: matchedAccount.igUsername,
      page_id: matchedAccount.pageId,
      page_name: matchedAccount.pageName,
      access_token: matchedAccount.pageAccessToken,
      token_type: 'bearer',
      expires_at: expiresAt,
      connected_at: Date.now(),
    };

    await kvClient.saveInstagramAuth(authRecord);

    logger.info('Instagram OAuth successfully completed and stored in KV', {
      username: authRecord.ig_username,
      igUserId: authRecord.ig_user_id,
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderSuccessHtml(authRecord));
  } catch (err: any) {
    logger.error('Unhandled exception during OAuth callback', undefined, err);
    return res.status(500).send(renderErrorHtml('Internal Server Error', err.message));
  }
}

function renderSuccessHtml(auth: InstagramAuthRecord): string {
  const expiryDate = new Date(auth.expires_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Instagram Connected | neuralpulse.hq</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090a0f;
      --card: rgba(18, 20, 29, 0.9);
      --border: rgba(255, 255, 255, 0.08);
      --success: #10b981;
      --accent: #6366f1;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      background-image: radial-gradient(circle at 50% 0%, rgba(16, 185, 129, 0.15) 0%, transparent 60%);
      color: #f8fafc;
      font-family: 'Space Grotesk', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      max-width: 500px;
      width: 100%;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 40px;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8);
    }
    .check-icon {
      width: 64px;
      height: 64px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--success);
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 24px;
    }
    h1 { font-size: 26px; margin-bottom: 8px; }
    p { color: #94a3b8; font-size: 15px; margin-bottom: 28px; }
    .account-box {
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      text-align: left;
      margin-bottom: 28px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13.5px;
    }
    .row { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .row:last-child { margin-bottom: 0; }
    .label { color: #64748b; }
    .val { color: #f1f5f9; font-weight: 500; }
    .val.green { color: #34d399; }
    .btn {
      display: inline-block;
      width: 100%;
      padding: 14px;
      background: #1e293b;
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      border-radius: 10px;
      transition: background 0.2s;
    }
    .btn:hover { background: #334155; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check-icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
    </div>
    <h1>Connected to Instagram!</h1>
    <p>neuralpulse.hq is now actively connected and listening for comment triggers and DM automations.</p>

    <div class="account-box">
      <div class="row"><span class="label">Instagram Account:</span><span class="val green">@${auth.ig_username}</span></div>
      <div class="row"><span class="label">Instagram ID:</span><span class="val">${auth.ig_user_id}</span></div>
      <div class="row"><span class="label">Linked Page:</span><span class="val">${auth.page_name}</span></div>
      <div class="row"><span class="label">Token Valid Until:</span><span class="val">${expiryDate}</span></div>
      <div class="row"><span class="label">State Storage:</span><span class="val green">Vercel KV (Active)</span></div>
    </div>

    <a href="/api/health" class="btn">View System Telemetry</a>
  </div>
</body>
</html>`;
}

function renderNoInstagramHtml(pages: any[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>No Instagram Account Linked | neuralpulse.hq</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
  <style>
    body { background: #090a0f; color: #f8fafc; font-family: 'Space Grotesk', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    .card { max-width: 500px; width: 100%; background: #12141d; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 36px; text-align: center; }
    h1 { font-size: 22px; margin-bottom: 12px; color: #f59e0b; }
    p { color: #94a3b8; font-size: 14.5px; line-height: 1.6; margin-bottom: 24px; }
    ol { text-align: left; margin: 0 auto 24px 20px; color: #cbd5e1; font-size: 14px; line-height: 1.8; }
    .btn { display: inline-block; padding: 12px 20px; background: #6366f1; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Instagram Professional Account Required</h1>
    <p>Meta authorized your Facebook login, but no Instagram Professional (Business or Creator) account is linked to your Facebook Page.</p>
    <ol>
      <li>Open the Instagram mobile app on your phone.</li>
      <li>Go to <b>Settings > Account > Switch to Professional Account</b>.</li>
      <li>In <b>Business Settings > Linked Accounts</b>, connect your Facebook Page.</li>
    </ol>
    <a href="/api/auth/login" class="btn">Retry Connection</a>
  </div>
</body>
</html>`;
}

function renderErrorHtml(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Authentication Error | neuralpulse.hq</title>
  <style>
    body { background: #090a0f; color: #f8fafc; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { max-width: 440px; background: #12141d; border: 1px solid #ef4444; border-radius: 12px; padding: 32px; text-align: center; }
    h1 { color: #ef4444; font-size: 20px; margin-bottom: 12px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.5; margin-bottom: 20px; }
    a { color: #6366f1; text-decoration: none; font-weight: 500; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/api/auth/login">← Back to Connect Screen</a>
  </div>
</body>
</html>`;
}
