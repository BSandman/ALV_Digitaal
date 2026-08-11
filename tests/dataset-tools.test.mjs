import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generator = path.join(projectRoot, 'mistral-lokaal', 'scripts', 'gen_synthetic.mjs');
const pseudonymizer = path.join(projectRoot, 'mistral-lokaal', 'scripts', 'pseudonymize.mjs');
const piiScanner = path.join(projectRoot, 'mistral-lokaal', 'scripts', 'pii_scan');

test('C1 is reproduceerbaar en dekt multi-VvE, quorumoverlap en niet-stemmers exact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alv-c1-'));
  try {
    const first = path.join(root, 'first.json');
    const second = path.join(root, 'second.json');
    assertRun(generator, ['--seed', '9182', '--offline', '--output', first]);
    assertRun(generator, ['--seed', '9182', '--offline', '--output', second]);
    assert.equal(await readFile(first, 'utf8'), await readFile(second, 'utf8'));

    const dataset = JSON.parse(await readFile(first, 'utf8'));
    const patterns = dataset.participants.map((participant) => participant.entitlements.map((item) => item.splitsing_code).join('+'));
    assert.ok(patterns.includes('PG+TF'));
    assert.ok(patterns.includes('PG+NB'));
    for (const [split, expected] of Object.entries(dataset.split_totals)) {
      const actual = dataset.participants.flatMap((participant) => participant.entitlements)
        .filter((item) => item.splitsing_code === split)
        .reduce((sum, item) => sum + units(item.weight), 0n);
      assert.equal(actual, units(expected));
    }

    const entitlements = dataset.participants.flatMap((participant) => participant.entitlements.map((item) => ({
      ...item, present: participant.attendance.present,
    })));
    const overlap = entitlements.find((item) => item.ref === dataset.scenarios.overlapping_attendance_and_power_ref);
    const powerOnly = entitlements.find((item) => item.ref === dataset.scenarios.power_only_entitlement_ref);
    const absent = entitlements.find((item) => item.ref === dataset.scenarios.absent_entitlement_ref);
    assert.equal(overlap.present, true);
    assert.equal(overlap.power_of_attorney.status, 'active');
    assert.equal(powerOnly.present, false);
    assert.equal(powerOnly.power_of_attorney.status, 'active');
    assert.equal(absent.present, false);
    assert.equal(absent.power_of_attorney, undefined);
    assert.equal(dataset.scenarios.non_voter_entitlement_refs.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C2 bewaart stemstructuur, verwijdert identiteit en blijft deterministisch binnen secure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alv-c2-'));
  try {
    const secure = path.join(root, 'secure');
    const output = path.join(root, 'out', 'owners.pseudo.json');
    await mkdir(secure, { recursive: true });
    const source = {
      meeting: { vve_code: 'Echte Residentie', meeting_date: '2026-09-01', invite_version: 2 },
      split_totals: { PG: '10000.0000', TF: '10000.0000' },
      scenarios: { non_voter_entitlement_refs: ['real-right-pg'] },
      participants: [{
        id: 'owner-1', display_name: 'Jan Echt', email: ['jan.echt', 'example.nl'].join('@'), address: 'Echtestraat 12',
        attendance: { present: true },
        entitlements: [
          { ref: 'real-right-pg', splitsing_code: 'PG', weight: '10000.0000', power_of_attorney: { status: 'active' } },
          { splitsing_code: 'TF', weight: '10000.0000' },
        ],
      }],
    };
    await writeFile(path.join(secure, 'owners.real.json'), JSON.stringify(source), 'utf8');
    const args = ['--secure-root', secure, '--input', path.join(secure, 'owners.real.json'), '--output', output];
    assertRun(pseudonymizer, args);
    const first = await readFile(output, 'utf8');
    assertRun(pseudonymizer, args);
    assert.equal(await readFile(output, 'utf8'), first);
    const pseudo = JSON.parse(first);
    assert.deepEqual(pseudo.participants[0].entitlements.map(({ splitsing_code, weight }) => ({ splitsing_code, weight })), [
      { splitsing_code: 'PG', weight: '10000.0000' }, { splitsing_code: 'TF', weight: '10000.0000' },
    ]);
    assert.deepEqual(pseudo.scenarios.non_voter_entitlement_refs, [pseudo.participants[0].entitlements[0].ref]);
    assert.doesNotMatch(first, /Jan Echt|jan\.echt|Echtestraat|Echte Residentie/);
    assert.ok((await readFile(path.join(secure, 'pseudonym-map.json'), 'utf8')).includes('owner-1'));
    assert.equal(spawnSync(process.execPath, [piiScanner, '--path', path.dirname(output)], { encoding: 'utf8' }).status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('C2 weigert gevoelige bestanden buiten secure en externe model-endpoints', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alv-c2-boundary-'));
  try {
    const secure = path.join(root, 'secure');
    await mkdir(secure, { recursive: true });
    const outside = path.join(root, 'owners.real.json');
    await writeFile(outside, '{}', 'utf8');
    const boundary = run(pseudonymizer, ['--secure-root', secure, '--input', outside]);
    assert.notEqual(boundary.status, 0);
    assert.match(boundary.stderr, /binnen de secure-map/);
    const endpoint = run(pseudonymizer, ['--secure-root', secure, '--endpoint', 'https://example.com']);
    assert.notEqual(endpoint.status, 0);
    assert.match(endpoint.stderr, /lokale HTTP-loopback/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function units(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
}

function assertRun(script, args) {
  const result = run(script, args);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true });
}
