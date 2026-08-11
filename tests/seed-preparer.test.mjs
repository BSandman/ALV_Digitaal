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

test('T-seed en app delen exact dezelfde fictieve AUTH_PEPPER', async () => {
  const compose = await readFile(path.join(projectRoot, 'infra', 'docker-compose.yml'), 'utf8');
  assert.match(compose, /SEED_AUTH_PEPPER: \$\{AUTH_PEPPER:-synthetic-dev-pepper-change-before-acceptance\}/);
  const pepperValues = [...compose.matchAll(/^\s+(?:SEED_)?AUTH_PEPPER: (.+)$/gm)].map((match) => match[1]);
  assert.equal(pepperValues.length, 2);
  assert.equal(pepperValues[0], pepperValues[1]);
});

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

test('seedvoorbereiding schrijft presentie, machtigingen en alleen gehashte credentials', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'alv-seed-complete-'));
  try {
    const syntheticDir = path.join(fixtureRoot, 'out', 'synthetic');
    const output = path.join(fixtureRoot, 'prepared');
    await mkdir(syntheticDir, { recursive: true });
    const plaintextCode = 'T001-0123456789abcdefghijkl';
    await writeFile(path.join(syntheticDir, 'owners.synthetic.json'), JSON.stringify({
      meeting: { vve_code: 'VVE-FICTIEF-UNIT', meeting_date: '2026-09-01', invite_version: 3 },
      split_totals: { PG: '10000.0000' },
      participants: [{
        display_name: 'Fictieve Eigenaar', object_label: 'Fictief object', attendance: { present: true },
        credential: { plaintext_code: plaintextCode },
        entitlements: [{ splitsing_code: 'PG', weight: '10000.0000', power_of_attorney: { status: 'active' } }],
      }],
    }), 'utf8');

    const result = runPreparer(fixtureRoot, output, 'synthetic-test-pepper-that-is-long-enough');
    assert.equal(result.status, 0, result.stderr);
    const sql = await readFile(path.join(output, '02-seed-synthetic.sql'), 'utf8');
    assert.match(sql, /INSERT INTO attendance/);
    assert.match(sql, /INSERT INTO power_of_attorney/);
    assert.match(sql, /INSERT INTO credential/);
    const decodedHexValues = [...sql.matchAll(/UNHEX\('([0-9a-f]+)'\)/gi)]
      .map((match) => Buffer.from(match[1], 'hex').toString('utf8'));
    assert.ok(decodedHexValues.some((value) => value.startsWith('scrypt-v1$')));
    assert.doesNotMatch(sql, new RegExp(plaintextCode));
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

function runPreparer(mistralRoot, output, pepper) {
  return spawnSync(process.execPath, [
    preparer,
    '--schema', schema,
    '--fallback', fallback,
    '--mistral-root', mistralRoot,
    '--output', output,
    ...(pepper ? ['--auth-pepper', pepper] : []),
  ], { encoding: 'utf8', windowsHide: true });
}
