import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preparer = path.join(projectRoot, 'infra', 'mysql', 'prepare-seed.mjs');
const schema = path.join(projectRoot, 'infra', 'mysql', 'init', '01-schema.sql');
const fallback = path.join(projectRoot, 'infra', 'mysql', 'init', '02-seed-synthetic.sql');

test('seedvoorbereiding kiest de fictieve 120-deelnemersfallback als Mistral-uitvoer ontbreekt', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'alv-seed-fallback-'));
  try {
    const output = path.join(fixtureRoot, 'prepared');
    const result = runPreparer(fixtureRoot, output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mini-seed/);
    assert.match(await readFile(path.join(output, '02-seed-synthetic.sql'), 'utf8'), /WHERE seq <= 120/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('seedvoorbereiding zet een veldgelijke synthetische Mistral-set om naar init-SQL', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'alv-seed-mistral-'));
  try {
    const syntheticDir = path.join(fixtureRoot, 'out', 'synthetic');
    const output = path.join(fixtureRoot, 'prepared');
    await mkdir(syntheticDir, { recursive: true });
    await writeFile(path.join(syntheticDir, 'owners.synthetic.json'), JSON.stringify({
      meeting: { vveCode: 'VVE-TEST-UNIT', meetingDate: '2026-09-01' },
      owners: [
        {
          displayName: 'Fictieve Eigenaar Alpha',
          objectLabel: 'Testobject A',
          entitlements: [
            { splitsingCode: 'A-001', weight: 1.25 },
            { splitsingCode: 'A-002', weight: '1/4' },
          ],
        },
      ],
    }), 'utf8');

    const result = runPreparer(fixtureRoot, output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1 fictieve deelnemer/);
    const sql = await readFile(path.join(output, '02-seed-synthetic.sql'), 'utf8');
    assert.match(sql, /VVE-TEST-UNIT/);
    assert.match(sql, /Fictieve Eigenaar Alpha/);
    assert.match(sql, /1\.2500/);
    assert.match(sql, /0\.2500/);
    assert.doesNotMatch(sql, /WHERE seq <= 120/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

function runPreparer(mistralRoot, output) {
  return spawnSync(process.execPath, [
    preparer,
    '--schema', schema,
    '--fallback', fallback,
    '--mistral-root', mistralRoot,
    '--output', output,
  ], { encoding: 'utf8', windowsHide: true });
}
