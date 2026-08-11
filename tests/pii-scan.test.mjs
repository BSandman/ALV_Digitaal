import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanner = path.join(projectRoot, 'mistral-lokaal', 'scripts', 'pii_scan');

test('PII-scan accepteert een schoon codepad', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'alv-pii-green-'));
  try {
    await writeFile(path.join(fixtureRoot, 'server.js'), 'export const status = "synthetic";\n', 'utf8');
    const result = runScanner('--path', fixtureRoot);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GROEN/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('PII-scan blokkeert een release-artefact met het historische eigenaarsbestand', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'alv-pii-artifact-red-'));
  try {
    const contentRoot = path.join(fixtureRoot, 'content');
    await mkdir(contentRoot);
    const forbiddenName = 'owners' + '.initial.js';
    await writeFile(path.join(contentRoot, forbiddenName), 'export default [];\n', 'utf8');
    const artifact = path.join(fixtureRoot, 'release.tgz');
    const packed = spawnSync('tar', ['-czf', artifact, '-C', contentRoot, forbiddenName], { encoding: 'utf8', windowsHide: true });
    assert.equal(packed.status, 0, packed.stderr);

    const result = runScanner('--artifact', artifact);
    assert.notEqual(result.status, 0, 'Het verboden eigenaarsbestand had de gate moeten blokkeren.');
    assert.match(result.stderr, /forbidden_file/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('PII-scan blokkeert een e-mailadres in fixtures', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'alv-pii-email-red-'));
  try {
    const address = ['persoon', 'voorbeeld.nl'].join('@');
    await writeFile(path.join(fixtureRoot, 'fixture.json'), JSON.stringify({ address }), 'utf8');
    const result = runScanner('--fixtures', fixtureRoot);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /email/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('PII-scan blokkeert een lokaal SSH-deploysleutelbestand', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'alv-pii-key-'));
  try {
    const keyPath = path.join(fixtureRoot, 'platform_alv_digitaal');
    await writeFile(keyPath, ['-----BEGIN OPENSSH', 'PRIVATE KEY-----'].join(' ') + '\nfictief\n', 'utf8');
    const result = runScanner('--path', keyPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /deploy_key|private_key/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

function runScanner(flag, target) {
  return spawnSync(process.execPath, [scanner, flag, target], { encoding: 'utf8', windowsHide: true });
}
