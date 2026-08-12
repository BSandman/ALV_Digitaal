import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const provisionPath = path.join(root, 'scripts', 'provision_env.sh');
const validatorPath = path.join(root, 'scripts', 'validate-provision-secrets.mjs');
const runbookPath = path.join(root, 'docs', 'gates', 'provisioning-runbook.md');

function validSecrets(target = 'acceptatie') {
  const database = target === 'acceptatie' ? 'cn111993_acceptatie' : 'cn111993_portaal';
  return [
    `DEPLOY_TARGET=${target}`,
    'DB_HOST=localhost',
    'DB_PORT=3306',
    `DB_NAME=${database}`,
    `DB_USER=${database}`,
    'DB_PASSWORD="fictief-met-specials-#!"',
    'AUTH_PEPPER=abcdefghijklmnopqrstuvwxyz-123456',
    'TRUST_PROXY=1',
    '',
  ].join('\n');
}

async function validate(content, target = 'acceptatie') {
  const directory = await mkdtemp(path.join(tmpdir(), 'alv-provision-validator-'));
  const source = path.join(directory, 'source.env');
  await writeFile(source, content, 'utf8');
  const result = spawnSync(process.execPath, [validatorPath, source, target], { encoding: 'utf8' });
  await rm(directory, { recursive: true, force: true });
  return result;
}

test('provisioning gebruikt doelvaste SSH-, pad- en productiegrenzen', async () => {
  const script = await readFile(provisionPath, 'utf8');
  assert.match(script, /--target acceptatie\|portaal/);
  assert.match(script, /ACCEPTATIE_SSH_HOST/);
  assert.match(script, /PORTAAL_SSH_HOST/);
  assert.match(script, /StrictHostKeyChecking=yes/);
  assert.match(script, /UserKnownHostsFile=/);
  assert.match(script, /git -C "\$PROJECT_ROOT" check-ignore/);
  assert.match(script, /BAS_PRODUCTION_GO/);
  assert.match(script, /--allow-production/);
  assert.match(script, /node --version/);
  assert.match(script, /v20\.\*/);
  assert.match(script, /require\(process\.argv\[1\]\)/);
  assert.match(script, /ERR_REQUIRE_ASYNC_MODULE|startupPromise/);
  assert.match(script, /chmod 600 "\$secrets_file"/);
  assert.doesNotMatch(script, /cat "\$SECRETS_SOURCE"|echo "\$DB_PASSWORD"/);
});

test('validator accepteert exact de acht doelgebonden sleutels', async () => {
  const result = await validate(validSecrets());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /exact 8 sleutels/);
});

test('validator weigert NODE_ENV en andere extra sleutels', async () => {
  const result = await validate(`${validSecrets()}NODE_ENV=production\n`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Niet-toegestane secretsleutel: NODE_ENV|exact deze sleutels/);
});

test('validator weigert dubbele sleutels', async () => {
  const result = await validate(`${validSecrets()}DB_PORT=3306\n`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Dubbele secretsleutel: DB_PORT/);
});

test('validator weigert verkeerde doel-DB en een te korte pepper', async () => {
  const wrongDatabase = await validate(
    validSecrets().replaceAll('cn111993_acceptatie', 'cn111993_portaal')
  );
  assert.equal(wrongDatabase.status, 1);
  assert.match(wrongDatabase.stderr, /horen niet bij acceptatie/);

  const weakPepper = await validate(
    validSecrets().replace('abcdefghijklmnopqrstuvwxyz-123456', 'te-kort')
  );
  assert.equal(weakPepper.status, 1);
  assert.match(weakPepper.stderr, /minimaal 32/);
});

test('runbook scheidt SSH-provisioning van DirectAdmin-stappen', async () => {
  const runbook = await readFile(runbookPath, 'utf8');
  assert.match(runbook, /Application mode \*\*Production\*\*/);
  assert.match(runbook, /Startup file is `src\/start\.js`/);
  assert.match(runbook, /SECRETS_FILE/);
  assert.match(runbook, /voeg geen handmatige `PORT` toe/);
  assert.match(runbook, /X-Forwarded-For/);
});
