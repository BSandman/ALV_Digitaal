import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gate = path.join(projectRoot, 'scripts', 'architecture-gate.mjs');

test('architectuurgate is groen voor de echte scaffold', () => {
  const result = runGate(projectRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /GROEN/);
});

test('architectuurgate faalt aantoonbaar op geprepareerde ADR-0002-overtredingen', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'alv-architecture-red-'));
  try {
    const sourceDir = path.join(fixtureRoot, 'app', 'src');
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, 'owner-route.js'), `
      const sessions = new Map();
      const socket = new WebSocket('wss://example.invalid');
      app.get('/deelnemen/api/profile', () => conn.query('SELECT * FROM participant'));
      conn.query("UPDATE round SET status = 'closed'");
      conn.query('INSERT INTO audit_event (created_at) VALUES (?)', [new Date()]);
    `, 'utf8');

    const result = runGate(fixtureRoot);
    assert.notEqual(result.status, 0, 'De geprepareerde overtreding had rood moeten zijn.');
    const output = result.stderr + result.stdout;
    for (const rule of ['ADR2-1-DB-STATE', 'ADR2-2-POLLING', 'ADR2-3-ATOMIC-RESULT', 'ADR2-4-ROW-FILTER', 'ADR2-5-SERVER-UTC']) {
      assert.match(output, new RegExp(rule), `Ontbrekend rood bewijs voor ${rule}`);
    }
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

function runGate(root) {
  return spawnSync(process.execPath, [gate, '--root', root], { encoding: 'utf8', windowsHide: true });
}
