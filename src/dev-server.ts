import http from 'http';
import { parse } from 'url';
import authLoginHandler from '../api/auth/login.js';
import authCallbackHandler from '../api/auth/callback.js';
import authStatusHandler from '../api/auth/status.js';
import publishHandler from '../api/publish.js';
import publishStatusHandler from '../api/publish-status.js';
import webhookHandler from '../api/webhook.js';
import healthHandler from '../api/health.js';
import { Logger } from './utils/logger.js';

const logger = new Logger('DevServer');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const routes: Record<string, (req: any, res: any) => Promise<any>> = {
  '/api/auth/login': authLoginHandler,
  '/api/auth/callback': authCallbackHandler,
  '/api/auth/status': authStatusHandler,
  '/api/publish': publishHandler,
  '/api/publish-status': publishStatusHandler,
  '/api/webhook': webhookHandler,
  '/api/health': healthHandler,
};

function createVercelResponse(res: http.ServerResponse): any {
  const customRes = res as any;

  customRes.status = function (statusCode: number) {
    res.statusCode = statusCode;
    return customRes;
  };

  customRes.json = function (jsonBody: any) {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(jsonBody, null, 2));
    return customRes;
  };

  customRes.send = function (body: any) {
    if (typeof body === 'object' && !Buffer.isBuffer(body)) {
      return customRes.json(body);
    }
    res.end(body);
    return customRes;
  };

  customRes.redirect = function (url: string) {
    res.writeHead(302, { Location: url });
    res.end();
    return customRes;
  };

  return customRes;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = parse(req.url || '', true);
  const pathname = parsedUrl.pathname || '';

  // Attach query params to req
  (req as any).query = parsedUrl.query || {};

  const vRes = createVercelResponse(res);

  // CORS headers for local dev testing
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Signature-256');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Home redirect
  if (pathname === '/' || pathname === '') {
    vRes.redirect('/api/auth/login');
    return;
  }

  const handler = routes[pathname];

  if (!handler) {
    vRes.status(404).json({
      error: 'Not Found',
      available_routes: Object.keys(routes),
    });
    return;
  }

  try {
    // For non-GET requests without custom raw stream reading, parse JSON if application/json
    if (req.method !== 'GET' && pathname !== '/api/webhook') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        (req as any).body = raw ? JSON.parse(raw) : {};
      } catch {
        (req as any).body = raw;
      }
    }

    await handler(req as any, vRes);
  } catch (err: any) {
    logger.error('Dev server route error', { pathname }, err);
    if (!res.headersSent) {
      vRes.status(500).json({ error: 'Internal Server Error', message: err?.message });
    }
  }
});

server.listen(PORT, () => {
  logger.info(`⚡ neuralpulse.hq local dev server running at: http://localhost:${PORT}`);
  logger.info(`👉 Connect Instagram URL: http://localhost:${PORT}/api/auth/login`);
});
