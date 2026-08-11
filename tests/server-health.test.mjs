import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestHandler } from '../app/src/server.js';

test('healthz is pas groen nadat de databasecheck slaagt', async () => {
  let checked = false;
  const handler = createRequestHandler({
    authStore: {}, voteStore: {},
    healthCheck: async () => { checked = true; },
  });
  const response = captureResponse();
  await handler(healthRequest(), response);
  assert.equal(checked, true);
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true, database: 'up', time: JSON.parse(response.body).time });
});

test('healthz faalt gesloten als MariaDB niet bereikbaar is', async () => {
  const handler = createRequestHandler({
    authStore: {}, voteStore: {},
    healthCheck: async () => { throw new Error('database_down_detail'); },
  });
  const response = captureResponse();
  await handler(healthRequest(), response);
  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.body), { error: 'internal_error' });
});

function healthRequest() {
  return { method: 'GET', url: '/healthz', headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } };
}

function captureResponse() {
  return {
    status: null, headers: null, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
}
