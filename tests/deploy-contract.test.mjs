import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deployPath = path.join(root, 'scripts', 'deploy.sh');
const acceptanceWorkflowPath = path.join(root, '.github', 'workflows', 'deploy-acceptatie.yml');
const productionWorkflowPath = path.join(root, '.github', 'workflows', 'deploy-productie.yml');

test('deployroute kiest acceptatie standaard en heeft doelgebonden coördinaten', async () => {
  const deploy = await readFile(deployPath, 'utf8');
  assert.match(deploy, /TARGET="acceptatie"/);
  assert.match(deploy, /ACCEPTATIE_SSH_HOST/);
  assert.match(deploy, /ACCEPTATIE_REMOTE_DIR/);
  assert.match(deploy, /ACCEPTATIE_SSH_PORT/);
  assert.match(deploy, /https:\/\/acceptatie\.honigfabriek\.nl\/healthz/);
  assert.match(deploy, /PORTAAL_SSH_HOST/);
  assert.match(deploy, /PORTAAL_REMOTE_DIR/);
  assert.match(deploy, /PORTAAL_SSH_PORT/);
  assert.match(deploy, /https:\/\/portaal\.honigfabriek\.nl\/healthz/);
  assert.match(deploy, /StrictHostKeyChecking=yes/);
  assert.match(deploy, /UserKnownHostsFile=/);
  assert.match(deploy, /BatchMode=yes/);
  assert.doesNotMatch(deploy, /stem\.honigfabriek\.nl/);
});

test('CD is handmatig, hoofdbranchgebonden en gebruikt gepinde SSH-hostsleutels', async () => {
  const acceptance = await readFile(acceptanceWorkflowPath, 'utf8');
  assert.match(acceptance, /workflow_dispatch:/);
  assert.doesNotMatch(acceptance, /^\s+push:/m);
  assert.match(acceptance, /refs\/heads\/main/);
  assert.match(acceptance, /secrets\.ACC_SSH_KEY/);
  assert.match(acceptance, /vars\.ACC_SSH_KNOWN_HOSTS/);
  assert.match(acceptance, /concurrency:[\s\S]*cancel-in-progress: false/);
});

test('productie-CD vereist tag, exacte bevestiging en GitHub production-environment', async () => {
  const production = await readFile(productionWorkflowPath, 'utf8');
  assert.match(production, /workflow_dispatch:/);
  assert.match(production, /environment: production/);
  assert.match(production, /refs\/tags\/\$\{\{ inputs\.release_tag \}\}/);
  assert.match(production, /portaal\.honigfabriek\.nl/);
  assert.match(production, /secrets\.PROD_SSH_KEY/);
  assert.match(production, /BAS_PRODUCTION_GO: JA/);
  assert.match(production, /--allow-production/);
});

test('productiedeploy vereist expliciete vlag én afzonderlijke Bas-go', async () => {
  const deploy = await readFile(deployPath, 'utf8');
  assert.match(deploy, /ALLOW_PRODUCTION.*BAS_PRODUCTION_GO/s);
  assert.match(deploy, /--allow-production/);
  assert.match(deploy, /BAS_PRODUCTION_GO=JA/);
});

test('deploy controleert code-only artefact, serversecrets, health en rollback', async () => {
  const deploy = await readFile(deployPath, 'utf8');
  assert.match(deploy, /pii_scan.*--artifact/);
  assert.match(deploy, /stat -c '%a'.*600/);
  assert.match(deploy, /SECRETS_FILE|REMOTE_SECRETS_FILE/);
  assert.match(deploy, /"database":"up"/);
  assert.match(deploy, /PREVIOUS_RELEASE/);
  assert.match(deploy, /REMOTE_ROLLBACK/);
  assert.doesNotMatch(deploy, /rsync[\s\S]*--delete/);
});
