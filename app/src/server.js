import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthStoreMariaDB } from './stores/mariadb/AuthStoreMariaDB.js';
import { createVoteStoreMariaDB } from './stores/mariadb/VoteStoreMariaDB.js';
import { getVerifiedClientIp } from './security/client-ip.js';
import { withConnection } from './db/pool.js';

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_PUBLIC_ROOT = fileURLToPath(new URL('../public/deelnemen/', import.meta.url));
const STATIC_CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
]);

export function createRequestHandler({
  authStore = process.env.AUTH_PEPPER
    ? createAuthStoreMariaDB({ pepper: process.env.AUTH_PEPPER })
    : null,
  voteStore = createVoteStoreMariaDB(),
  trustProxy = process.env.TRUST_PROXY === '1',
  healthCheck = checkDatabaseHealth,
  publicRoot = DEFAULT_PUBLIC_ROOT,
} = {}) {
  return async function requestHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/healthz') {
        await healthCheck();
        return json(res, 200, { ok: true, database: 'up', time: new Date().toISOString() });
      }

      if (req.method === 'GET' && url.pathname === '/deelnemen/api/status') {
        if (!authStore) return json(res, 503, { error: 'authentication_not_configured' }, noStore());
        const owner = await authenticateRequest(req, authStore);
        const roundId = positiveInteger(url.searchParams.get('roundId'));
        const status = await voteStore.getParticipantStatus(
          owner.participantId,
          owner.meetingId,
          roundId
        );
        if (!status) return json(res, 404, { error: 'round_not_found' }, noStore());
        const etag = createEtag(status);
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { ETag: etag, ...noStore() });
          return res.end();
        }
        return json(res, 200, status, { ETag: etag, ...noStore() });
      }

      if (req.method === 'POST' && url.pathname === '/deelnemen/api/login') {
        if (!authStore) return json(res, 503, { error: 'authentication_not_configured' }, noStore());
        const body = await readJson(req);
        const clientIp = getVerifiedClientIp(req, { trustProxy });
        const result = await authStore.authenticate({
          code: body.code,
          deviceBinding: body.deviceBinding,
          clientIp,
        });
        return json(res, 200, result, noStore());
      }

      if (url.pathname === '/deelnemen/api/vote') {
        if (!authStore) return json(res, 503, { error: 'authentication_not_configured' }, noStore());
        const owner = await authenticateRequest(req, authStore);
        if (req.method === 'POST') {
          const body = await readJson(req);
          const result = await voteStore.recordOwnerVote(
            requirePositiveInteger(body.roundId, 'roundId'),
            owner.participantId,
            { choice: body.choice }
          );
          return json(res, result.changed === false ? 200 : 201, result, noStore());
        }
        if (req.method === 'GET') {
          const result = await voteStore.getOwnerCurrentVote(
            requirePositiveInteger(url.searchParams.get('roundId'), 'roundId'),
            owner.participantId
          );
          return json(res, 200, result, noStore());
        }
      }

      if ((req.method === 'GET' || req.method === 'HEAD')
          && (url.pathname === '/deelnemen' || url.pathname.startsWith('/deelnemen/'))
          && !url.pathname.startsWith('/deelnemen/api/')) {
        return serveDeelnemenAsset(req, res, url, publicRoot);
      }

      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      return handleError(res, error);
    }
  };
}

async function authenticateRequest(req, authStore) {
  const authorization = req.headers.authorization;
  const deviceBinding = req.headers['x-device-binding'];
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
    const error = new Error('session_invalid');
    error.code = 'SESSION_INVALID';
    throw error;
  }
  return authStore.verifySession({
    sessionToken: authorization.slice('Bearer '.length),
    deviceBinding,
  });
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) {
      const error = new Error('payload_too_large');
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('invalid_json');
    error.code = 'INVALID_INPUT';
    throw error;
  }
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function requirePositiveInteger(value, field) {
  const parsed = positiveInteger(value);
  if (parsed) return parsed;
  const error = new Error(`${field}_invalid`);
  error.code = 'INVALID_INPUT';
  throw error;
}

function handleError(res, error) {
  const statusByCode = {
    AUTH_INVALID: 401,
    AUTH_LOCKED: 429,
    AUTH_RATE_LIMITED: 429,
    SESSION_INVALID: 401,
    DEVICE_BINDING_REQUIRED: 401,
    UNVERIFIED_CLIENT_IP: 400,
    ENTITLEMENT_FORBIDDEN: 403,
    ROUND_NOT_OPEN: 409,
    INVALID_INPUT: 400,
    PAYLOAD_TOO_LARGE: 413,
  };
  const status = statusByCode[error.code] ?? 500;
  const headers = {
    ...noStore(),
    ...(error.retryAfterSeconds ? { 'Retry-After': String(error.retryAfterSeconds) } : {}),
  };
  const message = status === 500 ? 'internal_error' : error.message;
  const body = status === 500
    ? { error: message }
    : { error: error.code ?? message, message };
  return json(res, status, body, headers);
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

export function startServer() {
  const handler = createRequestHandler();
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`[alv-app] luistert op :${PORT} (single process)`);
  });
  return server;
}

async function serveDeelnemenAsset(req, res, url, publicRoot) {
  if (url.pathname === '/deelnemen') {
    res.writeHead(308, { Location: '/deelnemen/', 'Cache-Control': 'no-store' });
    return res.end();
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return json(res, 400, { error: 'invalid_path' }, noStore());
  }
  const relative = decodedPath.slice('/deelnemen/'.length);
  if (relative.includes('\\') || relative.includes('\0')
      || relative.split('/').includes('..')) {
    return json(res, 400, { error: 'invalid_path' }, noStore());
  }

  const requested = relative === '' ? 'index.html' : relative;
  const extension = path.extname(requested).toLowerCase();
  const shellFallback = extension === '';
  const assetName = shellFallback ? 'index.html' : requested;
  const contentType = STATIC_CONTENT_TYPES.get(path.extname(assetName).toLowerCase());
  if (!contentType) return json(res, 404, { error: 'not_found' }, noStore());

  const root = path.resolve(publicRoot);
  const file = path.resolve(root, assetName);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    return json(res, 400, { error: 'invalid_path' }, noStore());
  }

  try {
    const body = await readFile(file);
    const cacheControl = assetName === 'index.html'
      ? 'no-cache'
      : 'public, max-age=3600';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      return json(res, 404, { error: 'not_found' }, noStore());
    }
    throw error;
  }
}

function createEtag(body) {
  return `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}"`;
}

function noStore() {
  return { 'Cache-Control': 'no-store' };
}

async function checkDatabaseHealth() {
  await withConnection((conn) => conn.execute('SELECT 1'));
}
