import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { HttpError } from './lib/errors.js';
import { createLimiter } from './lib/rateLimit.js';
import { Router } from './lib/router.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBookingRoutes } from './routes/bookings.js';
import { registerResourceRoutes } from './routes/resources.js';
import { createMailer } from './services/mailer.js';

const MAX_BODY_BYTES = 100 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function setSecurityHeaders(res) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readJsonBody(req) {
  const length = Number(req.headers['content-length'] ?? 0);
  if (length > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', 'Request body is too large');

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', 'Request body is too large');
    chunks.push(chunk);
  }
  if (size === 0) return {};

  if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send the body as application/json');
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'invalid_json', 'The request body must be a JSON object');
  }
  return parsed;
}

function errorBody(err) {
  if (err instanceof HttpError) {
    const body = { code: err.code, message: err.message };
    if (err.details) body.details = err.details;
    return { status: err.status, body: { error: body } };
  }
  // Anything unexpected: log it here, tell the client nothing about the internals.
  console.error(err);
  return {
    status: 500,
    body: { error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again.' } },
  };
}

function serveStatic(req, res, pathname, publicDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');

  let requested;
  try {
    requested = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'bad_request', 'Malformed URL');
  }
  if (requested === '/') requested = '/index.html';

  const file = path.normalize(path.join(publicDir, requested));
  const inside = file === publicDir || file.startsWith(publicDir + path.sep);
  if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new HttpError(404, 'not_found', 'Page not found');
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

export function createApp({ config, db, mailer = createMailer(config) }) {
  const router = new Router();
  const loginLimiter = createLimiter(config.loginLimit);
  const resetLimiter = createLimiter(config.resetLimit);
  const resetCodeLimiter = createLimiter(config.resetCodeLimit);

  router.add('GET', '/api/health', () => ({ status: 'ok' }));
  router.add('GET', '/api/config', () => ({ booking_rules: config.rules }));
  registerAuthRoutes(router);
  registerResourceRoutes(router);
  registerBookingRoutes(router);

  async function handleApi(req, res, url) {
    const found = router.match(req.method, url.pathname);
    if (!found) throw new HttpError(404, 'not_found', 'No such endpoint');
    if (found.methodNotAllowed) throw new HttpError(405, 'method_not_allowed', 'Method not allowed for this endpoint');

    const ctx = {
      req,
      res,
      db,
      config,
      loginLimiter,
      resetLimiter,
      resetCodeLimiter,
      mailer,
      ip: req.socket.remoteAddress,
      params: found.params,
      query: Object.fromEntries(url.searchParams),
      body: req.method === 'GET' || req.method === 'DELETE' ? {} : await readJsonBody(req),
      user: null,
      status: 200,
    };

    for (const handler of found.route.handlers) {
      const result = await handler(ctx);
      if (result !== undefined) return sendJson(res, ctx.status, result);
    }
    res.writeHead(204).end();
  }

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else serveStatic(req, res, url.pathname, config.publicDir);
    } catch (err) {
      const { status, body } = errorBody(err);
      if (res.headersSent) return res.end();
      if (req.url.startsWith('/api/')) sendJson(res, status, body);
      else {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(body.error.message);
      }
    }
  });

  return server;
}
