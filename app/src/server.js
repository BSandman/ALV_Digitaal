import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createAuthStoreMariaDB } from './stores/mariadb/AuthStoreMariaDB.js';
import { createVoteStoreMariaDB } from './stores/mariadb/VoteStoreMariaDB.js';
import { getVerifiedClientIp } from './security/client-ip.js';

const PORT = Number(process.env.PORT || 3000);

export function createRequestHandler({
  authStore = process.env.AUTH_PEPPER
    ? createAuthStoreMariaDB({ pepper: process.env.AUTH_PEPPER })
    : null,
  voteStore = createVoteStoreMariaDB(),
  trustProxy = process.env.TRUST_PROXY === '1',
} = {}) {
  return async function requestHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, { ok: true, time: new Date().toISOString() });
      }

      if (req.method === 'GET' && url.pathname === '/deelnemen/api/status') {
        const roundId = positiveInteger(url.searchParams.get('roundId'));
        const status = roundId
          ? await voteStore.getRoundStatus(roundId)
          : { version: 0, round: 'waiting', remainingSeconds: 0 };
        if (!status) return json(res, 404, { error: 'round_not_found' });
        const etag = `"${status.roundVersion ?? status.version ?? 0}-${status.status ?? status.round}-${status.remainingSeconds}"`;
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { ETag: etag });
          return res.end();
        }
        return json(res, 200, status, { ETag: etag, 'Cache-Control': 'no-store' });
      }

      if (req.method === 'POST' && url.pathname === '/deelnemen/api/login') {
        if (!authStore) return json(res, 503, { error: 'authentication_not_configured' });
        const body = await readJson(req);
        const clientIp = getVerifiedClientIp(req, { trustProxy });
        const result = await authStore.authenticate({
          code: body.code,
          deviceBinding: body.deviceBinding,
          clientIp,
        });
        return json(res, 200, result, { 'Cache-Control': 'no-store' });
      }

      if (url.pathname === '/deelnemen/api/vote') {
        if (!authStore) return json(res, 503, { error: 'authentication_not_configured' });
        const owner = await authenticateRequest(req, authStore);
        if (req.method === 'POST') {
          const body = await readJson(req);
          const result = await voteStore.recordVote(
            requirePositiveInteger(body.roundId, 'roundId'),
            owner.participantId,
            {
              entitlementId: requirePositiveInteger(body.entitlementId, 'entitlementId'),
              choice: body.choice,
            }
          );
          return json(res, 201, result, { 'Cache-Control': 'no-store' });
        }
        if (req.method === 'GET') {
          const result = await voteStore.getCurrentVote(
            requirePositiveInteger(url.searchParams.get('roundId'), 'roundId'),
            owner.participantId,
            requirePositiveInteger(url.searchParams.get('entitlementId'), 'entitlementId')
          );
          return json(res, 200, result, { 'Cache-Control': 'no-store' });
        }
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
  const headers = error.retryAfterSeconds ? { 'Retry-After': String(error.retryAfterSeconds) } : {};
  const message = status === 500 ? 'internal_error' : error.message;
  return json(res, status, { error: message }, headers);
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const handler = createRequestHandler();
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`[alv-app] luistert op :${PORT} (single process)`);
  });
}
