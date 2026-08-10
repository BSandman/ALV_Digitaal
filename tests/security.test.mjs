import assert from 'node:assert/strict';
import test from 'node:test';
import {
  credentialLocator,
  generateCredentialCode,
  hashCredentialCode,
  keyedHash,
  verifyCredentialCode,
} from '../app/src/security/credential-crypto.js';
import { getVerifiedClientIp } from '../app/src/security/client-ip.js';

const pepper = 'unit-test-pepper-with-at-least-32-bytes';

test('gegenereerde toegangscode bevat 128 bits willekeur en wordt alleen als hash geverifieerd', async () => {
  const code = generateCredentialCode('TEST001');
  const randomPart = code.slice('TEST001-'.length);
  assert.equal(Buffer.from(randomPart, 'base64url').length, 16);
  assert.equal(credentialLocator(code), 'TEST001');

  const stored = await hashCredentialCode(code);
  assert.equal(await verifyCredentialCode(code, stored), true);
  assert.equal(await verifyCredentialCode(`${code}x`, stored), false);
  assert.equal(stored.includes(code), false);
});

test('keyed hashes scheiden credential-, sessie- en IP-domeinen', () => {
  const input = 'dezelfde-waarde';
  assert.notDeepEqual(keyedHash(input, pepper, 'credential'), keyedHash(input, pepper, 'client-ip'));
});

test('fout geheim deel behoudt dezelfde locator voor begrenzing per credential', () => {
  assert.equal(credentialLocator('TEST001-goed'), credentialLocator('TEST001-fout'));
});

test('proxy-IP wordt alleen als één door Caddy overschreven hop geaccepteerd', () => {
  const request = {
    socket: { remoteAddress: '172.20.0.5' },
    headers: { 'x-forwarded-for': '203.0.113.8' },
  };
  assert.equal(getVerifiedClientIp(request, { trustProxy: true }), '203.0.113.8');
  assert.throws(
    () => getVerifiedClientIp({ ...request, headers: { 'x-forwarded-for': '203.0.113.8, 10.0.0.1' } }, { trustProxy: true }),
    { code: 'UNVERIFIED_CLIENT_IP' }
  );
});
