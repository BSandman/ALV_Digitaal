import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '../app/src/server.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(projectRoot, 'app', 'public', 'deelnemen');

test('Node serveert de deelnemen-shell en alleen gewhiteliste assettypen met veilige caches', async () => {
  const handler = createRequestHandler({ authStore: {}, voteStore: {}, publicRoot });

  const shell = await invoke(handler, 'GET', '/deelnemen/');
  assert.equal(shell.status, 200);
  assert.match(shell.headers['Content-Type'], /^text\/html/);
  assert.equal(shell.headers['Cache-Control'], 'no-cache');
  assert.match(shell.text, /<html lang="nl">/);

  const script = await invoke(handler, 'GET', '/deelnemen/app.js');
  assert.equal(script.status, 200);
  assert.match(script.headers['Content-Type'], /^text\/javascript/);
  assert.equal(script.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(script.headers['Cache-Control'], 'public, max-age=3600');

  const unsupported = await invoke(handler, 'GET', '/deelnemen/payload.json');
  assert.equal(unsupported.status, 404);
});

test('statische serving weigert gewone en ge-encodeerde traversal buiten de public-root', async () => {
  const handler = createRequestHandler({ authStore: {}, voteStore: {}, publicRoot });
  for (const target of [
    '/deelnemen/../package.json',
    '/deelnemen/%2e%2e/package.json',
    '/deelnemen/..%2fpackage.json',
    '/deelnemen/%5c..%5cpackage.json',
  ]) {
    const response = await invoke(handler, 'GET', target);
    assert.ok([400, 404].includes(response.status), `${target} gaf ${response.status}`);
    assert.doesNotMatch(response.text, /alv-digitaal-app/);
  }
});

test('statuspoll is sessie- en participantgebonden en respecteert ETag 304 na verificatie', async () => {
  let verifications = 0;
  const authStore = {
    async verifySession(input) {
      verifications += 1;
      assert.deepEqual(input, { sessionToken: 'token', deviceBinding: 'device-binding-123456' });
      return { participantId: 11, meetingId: 3 };
    },
  };
  const status = {
    participant: { displayName: 'Test Eigenaar', objectLabel: 'Testobject' },
    meeting: { vveCode: 'VVE-TEST', date: '2026-09-01' },
    version: 2,
    status: 'open',
    remainingSeconds: 25,
    round: { id: 7, title: 'Synthetisch voorstel', splitsingen: ['TF', 'PG'] },
    eligible: true,
    entitlements: [
      { splitsingCode: 'TF', weight: '1.2500' },
      { splitsingCode: 'PG', weight: '0.5000' },
    ],
  };
  const voteStore = {
    async getParticipantStatus(participantId, meetingId, roundId) {
      assert.deepEqual({ participantId, meetingId, roundId }, { participantId: 11, meetingId: 3, roundId: null });
      return status;
    },
  };
  const handler = createRequestHandler({ authStore, voteStore });
  const headers = ownerHeaders();
  const first = await invoke(handler, 'GET', '/deelnemen/api/status', { headers });
  assert.equal(first.status, 200);
  assert.deepEqual(JSON.parse(first.text), status);
  assert.equal(first.headers['Cache-Control'], 'no-store');
  assert.match(first.headers.ETag, /^"[A-Za-z0-9_-]+"$/);

  const second = await invoke(handler, 'GET', '/deelnemen/api/status', {
    headers: { ...headers, 'if-none-match': first.headers.ETag },
  });
  assert.equal(second.status, 304);
  assert.equal(second.text, '');
  assert.equal(verifications, 2, 'ook een 304 wordt pas na sessieverificatie gegeven');
});

test('vote-API accepteert één keuze zonder clientgestuurde entitlement en leest de eigenaarstem row-level', async () => {
  const calls = [];
  const authStore = { async verifySession() { return { participantId: 11, meetingId: 3 }; } };
  const voteStore = {
    async recordOwnerVote(roundId, participantId, vote) {
      calls.push({ kind: 'write', roundId, participantId, vote });
      return { roundId, choice: vote.choice, entitlementCount: 2, acceptedAt: '2026-08-22T14:00:00.000Z', changed: true };
    },
    async getOwnerCurrentVote(roundId, participantId) {
      calls.push({ kind: 'read', roundId, participantId });
      return { roundId, choice: 'voor', entitlementCount: 2, acceptedAt: '2026-08-22T14:00:00.000Z' };
    },
  };
  const handler = createRequestHandler({ authStore, voteStore });
  const written = await invoke(handler, 'POST', '/deelnemen/api/vote', {
    headers: { ...ownerHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ roundId: 7, choice: 'voor', entitlementId: 999999 }),
  });
  assert.equal(written.status, 201);
  assert.deepEqual(calls[0], { kind: 'write', roundId: 7, participantId: 11, vote: { choice: 'voor' } });

  const read = await invoke(handler, 'GET', '/deelnemen/api/vote?roundId=7', { headers: ownerHeaders() });
  assert.equal(read.status, 200);
  assert.deepEqual(calls[1], { kind: 'read', roundId: 7, participantId: 11 });
  assert.equal(JSON.parse(read.text).choice, 'voor');
});

test('auth-lockout en rate-limit publiceren foutcode, Retry-After en no-store', async () => {
  const authStore = {
    async authenticate() {
      const error = new Error('authentication_rate_limited');
      error.code = 'AUTH_RATE_LIMITED';
      error.retryAfterSeconds = 37;
      throw error;
    },
  };
  const handler = createRequestHandler({ authStore, voteStore: {} });
  const response = await invoke(handler, 'POST', '/deelnemen/api/login', {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'ONGELDIG', deviceBinding: 'device-binding-123456' }),
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers['Retry-After'], '37');
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(JSON.parse(response.text).error, 'AUTH_RATE_LIMITED');
});

test('frontendcontract dekt in-memory token, ETag+jitter-stop, twee keuzes en basis-a11y', async () => {
  const [html, css, script, vendor] = await Promise.all([
    readFile(path.join(publicRoot, 'index.html'), 'utf8'),
    readFile(path.join(publicRoot, 'app.css'), 'utf8'),
    readFile(path.join(publicRoot, 'app.js'), 'utf8'),
    readFile(path.join(publicRoot, 'vendor', 'platform-tokens.css'), 'utf8'),
  ]);

  assert.doesNotMatch(script, /localStorage|sessionStorage|document\.cookie/);
  assert.match(script, /var sessionToken = null/);
  assert.match(script, /credentials: 'omit'/);
  assert.match(script, /If-None-Match/);
  assert.match(script, /response\.status === 304/);
  assert.match(script, /Math\.random\(\)/);
  assert.match(script, /status\.status === 'open' \|\| status\.status === 'waiting'/);
  assert.deepEqual([...html.matchAll(/data-choice="([^"]+)"/g)].map((match) => match[1]), ['voor', 'tegen']);
  assert.doesNotMatch(html, /data-choice="(?:blanco|onthouding)"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /<fieldset/);
  assert.match(html, /<dialog/);
  assert.match(css, /min-height: var\(--tap-min\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgb\(|\boklch\(|font-family:\s*["']?(?:Archivo|IBM Plex Mono)/i);
  assert.match(vendor.split(/\r?\n/, 1)[0], /bron: Platform\/platform-tokens\.css v1\.0\.0/);
  assert.match(vendor, /--tf:.*oklch/);
  assert.match(vendor, /--nb:.*oklch/);
  assert.match(vendor, /--pg:.*oklch/);
});

test('code-only releasebouwer neemt alle eigenaar-frontend-assets expliciet mee', async () => {
  const buildScript = await readFile(path.join(projectRoot, 'scripts', 'build-release.mjs'), 'utf8');
  assert.match(buildScript, /'src', 'public'/);
  for (const asset of [
    'public/deelnemen/index.html',
    'public/deelnemen/app.css',
    'public/deelnemen/app.js',
    'public/deelnemen/vendor/platform-tokens.css',
  ]) {
    assert.match(buildScript, new RegExp(asset.replaceAll('/', '\\/').replaceAll('.', '\\.')));
  }
});

function ownerHeaders() {
  return {
    host: 'localhost',
    authorization: 'Bearer token',
    'x-device-binding': 'device-binding-123456',
  };
}

async function invoke(handler, method, url, { headers = {}, body = '' } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  request.method = method;
  request.url = url;
  request.headers = { host: 'localhost', ...headers };
  request.socket = { remoteAddress: '127.0.0.1' };
  const response = captureResponse();
  await handler(request, response);
  return response;
}

function captureResponse() {
  return {
    status: null,
    headers: {},
    text: '',
    writeHead(status, headers) { this.status = status; this.headers = headers ?? {}; },
    end(body) { this.text = body ? Buffer.from(body).toString('utf8') : ''; },
  };
}
