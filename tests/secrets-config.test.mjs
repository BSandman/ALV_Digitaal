import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertSecurePermissions,
  loadRuntimeConfiguration,
  parseSecretsFile,
  validateRuntimeConfiguration,
} from '../app/src/config/secrets-file.js';

const fixedSqlMode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION,NO_BACKSLASH_ESCAPES';

test('SECRETS_FILE laadt acceptatieconfig buiten de app en zet veilige defaults', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alv-secrets-'));
  try {
    const appRoot = path.join(root, 'application');
    const secretsFile = path.join(root, 'secrets', 'alv-acceptatie.env');
    await mkdir(appRoot, { recursive: true });
    await mkdir(path.dirname(secretsFile), { recursive: true });
    await writeFile(secretsFile, acceptanceSecrets(), { encoding: 'utf8', mode: 0o600 });
    const env = { SECRETS_FILE: secretsFile };

    const result = await loadRuntimeConfiguration({ env, appRoot, platform: 'win32' });
    assert.deepEqual({ loaded: result.loaded, target: result.target }, { loaded: true, target: 'acceptatie' });
    assert.equal(env.NODE_ENV, 'production');
    assert.equal(env.DB_NAME, 'cn111993_acceptatie');
    assert.equal(env.DB_SESSION_SQL_MODE, fixedSqlMode);
    assert.equal(env.TRUST_PROXY, '1');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtimeconfig weigert een acceptatiedoel dat naar de productiedatabase wijst', () => {
  const env = Object.assign(baseRuntime(), {
    DEPLOY_TARGET: 'acceptatie',
    DB_NAME: 'cn111993_portaal',
    DB_USER: 'cn111993_portaal',
  });
  assert.throws(() => validateRuntimeConfiguration(env), { code: 'DATABASE_TARGET_MISMATCH' });
});

test('productiestart weigert zonder SECRETS_FILE en secrets binnen de application root', async () => {
  await assert.rejects(() => loadRuntimeConfiguration({ env: { NODE_ENV: 'production' } }), {
    code: 'SECRETS_FILE_REQUIRED',
  });

  const root = await mkdtemp(path.join(os.tmpdir(), 'alv-secrets-inside-'));
  try {
    const secretsFile = path.join(root, 'config', 'server.env');
    await mkdir(path.dirname(secretsFile), { recursive: true });
    await writeFile(secretsFile, acceptanceSecrets(), 'utf8');
    await assert.rejects(() => loadRuntimeConfiguration({
      env: { SECRETS_FILE: secretsFile }, appRoot: root, platform: 'win32',
    }), { code: 'SECRETS_FILE_INSIDE_APP' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parser accepteert dotenv-quotes maar weigert dubbele en procesgevaarlijke sleutels', () => {
  const parsed = parseSecretsFile("DB_PASSWORD='met # teken'\nAUTH_PEPPER=abcdefghijklmnopqrstuvwxyz-123456\n");
  assert.equal(parsed.DB_PASSWORD, 'met # teken');
  assert.throws(() => parseSecretsFile('NODE_OPTIONS=--inspect\n'), { code: 'SECRETS_KEY_FORBIDDEN' });
  assert.throws(() => parseSecretsFile('DB_NAME=a\nDB_NAME=b\n'), { code: 'SECRETS_KEY_DUPLICATE' });
});

test('POSIX secretsrechten moeten owner-only zijn', () => {
  const regularFile = (mode) => ({ mode, isFile: () => true });
  assert.doesNotThrow(() => assertSecurePermissions(regularFile(0o100600), 'linux'));
  assert.throws(() => assertSecurePermissions(regularFile(0o100640), 'linux'), { code: 'SECRETS_FILE_PERMISSIONS' });
});

function acceptanceSecrets() {
  return [
    'DEPLOY_TARGET=acceptatie',
    'DB_HOST=localhost',
    'DB_PORT=3306',
    'DB_NAME=cn111993_acceptatie',
    'DB_USER=cn111993_acceptatie',
    'DB_PASSWORD=fictief-testwachtwoord',
    'DB_POOL_SIZE=5',
    `DB_SESSION_SQL_MODE=${fixedSqlMode}`,
    'AUTH_PEPPER=abcdefghijklmnopqrstuvwxyz-123456',
    'TRUST_PROXY=1',
    '',
  ].join('\n');
}

function baseRuntime() {
  return {
    DEPLOY_TARGET: 'acceptatie', DB_HOST: 'localhost', DB_PORT: '3306',
    DB_NAME: 'cn111993_acceptatie', DB_USER: 'cn111993_acceptatie', DB_PASSWORD: 'test',
    DB_POOL_SIZE: '5', DB_SESSION_SQL_MODE: fixedSqlMode,
    AUTH_PEPPER: 'abcdefghijklmnopqrstuvwxyz-123456', TRUST_PROXY: '1',
  };
}
