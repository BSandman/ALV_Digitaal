import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entrypoint = path.join(root, 'app', 'src', 'start.js');

test('LiteSpeed lsnode kan de ESM-startentry synchroon require()n zonder top-level await', () => {
  const environment = { ...process.env, PORT: '0' };
  for (const name of ['SECRETS_FILE', 'NODE_ENV', 'DEPLOY_TARGET']) delete environment[name];

  const childScript = `
    const { once } = require('node:events');
    const entry = require(${JSON.stringify(entrypoint)});
    if (!entry.startupPromise || typeof entry.startupPromise.then !== 'function') {
      throw new Error('startupPromise ontbreekt');
    }
    entry.startupPromise.then(async (server) => {
      if (!server.listening) await once(server, 'listening');
      server.close((error) => {
        if (error) throw error;
      });
    }).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;
  const result = spawnSync(process.execPath, ['--input-type=commonjs', '--eval', childScript], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    timeout: 10_000,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr, /ERR_REQUIRE_ASYNC_MODULE|top-level await/i);
});
