import assert from 'node:assert/strict';
import test from 'node:test';
import { hashCredentialCode } from '../app/src/security/credential-crypto.js';
import { createAuthStoreMariaDB } from '../app/src/stores/mariadb/AuthStoreMariaDB.js';

const pepper = 'unit-test-pepper-with-at-least-32-bytes';
const deviceBinding = 'test-device-binding-0001';

test('geslaagde login revokeert oude sessie, invalideert machtiging en auditeert dit atomair', async () => {
  const code = 'TEST001-valid-random-part';
  const codeHash = await hashCredentialCode(code);
  const calls = [];
  const conn = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SUM\(client_ip_hash/.test(sql)) return [[{ ip_failures: 0, credential_failures: 0 }]];
      if (/FROM credential/.test(sql)) return [[{
        id: 4, participant_id: 8, meeting_id: 2, code_hash: codeHash,
        failed_attempts: 0, lock_seconds: 0,
      }]];
      if (/SELECT pa\.id/.test(sql)) return [[{ id: 12, entitlement_id: 19 }]];
      return [{}];
    },
    async execute(sql, params) { return this.query(sql, params); },
  };
  const store = createAuthStoreMariaDB({ pepper, withTransactionFn: (fn) => fn(conn) });
  const result = await store.authenticate({ code, deviceBinding, clientIp: '203.0.113.9' });

  assert.equal(result.participantId, 8);
  assert.equal(result.invalidatedPowerCount, 1);
  assert.ok(result.sessionToken.length >= 40);
  assert.ok(calls.some(({ sql }) => /UPDATE session SET revoked_at = UTC_TIMESTAMP/.test(sql)));
  assert.ok(calls.some(({ sql }) => /pa\.status = 'invalidated_owner_login'/.test(sql)));
  assert.ok(calls.some(({ sql }) => /power_of_attorney_invalidated_owner_login/.test(sql)));
  assert.ok(calls.some(({ sql }) => /INSERT INTO session/.test(sql)));
});

test('rate limiting geldt vóór verificatie zowel per IP als credential-hash', async () => {
  const calls = [];
  let committed = false;
  const conn = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SUM\(client_ip_hash/.test(sql)) return [[{ ip_failures: 20, credential_failures: 0 }]];
      return [{}];
    },
    async execute(sql, params) { return this.query(sql, params); },
  };
  const store = createAuthStoreMariaDB({
    pepper,
    withTransactionFn: async (fn) => {
      const result = await fn(conn);
      committed = true;
      return result;
    },
  });
  await assert.rejects(
    store.authenticate({ code: 'TEST001-anything', deviceBinding, clientIp: '203.0.113.10' }),
    { code: 'AUTH_RATE_LIMITED' }
  );
  assert.ok(calls.some(({ sql }) => /INSERT INTO authentication_attempt/.test(sql)));
  assert.equal(calls.some(({ sql }) => /FROM credential/.test(sql)), false);
  assert.equal(committed, true, 'De afwijzing moet pas na het committen worden gegooid.');
});

test('mislukte credentialverificatie verhoogt teller en zet exponentiële backoff', async () => {
  const codeHash = await hashCredentialCode('TEST001-correct-secret');
  const calls = [];
  let committed = false;
  const conn = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/SUM\(client_ip_hash/.test(sql)) return [[{ ip_failures: 0, credential_failures: 0 }]];
      if (/FROM credential/.test(sql)) return [[{
        id: 4, participant_id: 8, meeting_id: 2, code_hash: codeHash,
        failed_attempts: 2, lock_seconds: 0,
      }]];
      return [{}];
    },
    async execute(sql, params) { return this.query(sql, params); },
  };
  const store = createAuthStoreMariaDB({
    pepper,
    baseBackoffSeconds: 2,
    withTransactionFn: async (fn) => {
      const result = await fn(conn);
      committed = true;
      return result;
    },
  });
  await assert.rejects(
    store.authenticate({ code: 'TEST001-wrong-secret', deviceBinding, clientIp: '203.0.113.11' }),
    { code: 'AUTH_INVALID', retryAfterSeconds: 8 }
  );
  const lockUpdate = calls.find(({ sql }) => /SET failed_attempts/.test(sql));
  assert.deepEqual(lockUpdate.params, [3, 8, 4]);
  assert.equal(committed, true, 'Teller en lockout mogen niet worden teruggedraaid.');
});
