import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  integrationPlan,
  parseFrontmatter,
  parseSyncCounts,
  progressLine,
  updateFrontmatter,
  writeAtomic,
} from '../mistral-lokaal/scripts/run_integration_turn.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'mistral-lokaal', 'scripts', 'run_integration_turn.mjs');
const FIXED_NOW = '2026-08-13T08:00:00Z';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function git(repo, ...args) {
  const result = run('git', args, { cwd: repo });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createFixture({ deploySentinel = false } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'alv-integration-runner-'));
  const repo = path.join(parent, 'repo');
  const remote = path.join(parent, 'remote.git');
  fs.mkdirSync(repo);
  git(parent, 'init', '--bare', remote);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Runner Test');
  git(repo, 'config', 'user.email', 'runner-at-example.invalid');

  fs.mkdirSync(path.join(repo, 'app'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'mistral-lokaal', 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'handoff.md'),
    [
      '---',
      'sprint: 6',
      'state: READY_FOR_INTEGRATION',
      'owner: mistral',
      'since: 2026-08-13T07:00:00Z',
      'next: claude',
      'action_required_by: none',
      'blocked: false',
      'note: "Fixture gereed voor integratie."',
      '---',
      '',
      '# Fixture',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(repo, 'progress.md'), '# Progress\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '__pycache__/\n');
  fs.writeFileSync(
    path.join(repo, 'tests', 'test_fixture.py'),
    'import unittest\n\nclass FixtureTest(unittest.TestCase):\n    def test_green(self):\n        self.assertTrue(True)\n',
  );
  const checkScript = deploySentinel
    ? "node -e \"require('node:fs').writeFileSync('../deploy-was-called','no')\""
    : "node -e \"process.exit(0)\"";
  fs.writeFileSync(
    path.join(repo, 'app', 'package.json'),
    JSON.stringify({ private: true, scripts: { check: checkScript } }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(repo, 'mistral-lokaal', 'scripts', 'pii_scan'),
    '#!/usr/bin/env node\nprocess.exit(0);\n',
  );
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'test: initialize controlled fixture');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'main');
  return { parent, repo };
}

function runRunner(repo, ...args) {
  return run(process.execPath, [RUNNER, '--stdin', '--repo', repo, '--now', FIXED_NOW, ...args], {
    cwd: repo,
    input: 'begrensde fixturecontext\n',
  });
}

test('Mistral-runner voltooit een gecontroleerde beurt schoon en in sync', () => {
  const fixture = createFixture();
  try {
    const result = runRunner(fixture.repo);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const handoff = parseFrontmatter(fs.readFileSync(path.join(fixture.repo, 'handoff.md'), 'utf8'));
    assert.equal(handoff.state, 'SPRINT_DONE');
    assert.equal(handoff.owner, 'claude');
    assert.equal(handoff.action_required_by, 'none');
    assert.match(fs.readFileSync(path.join(fixture.repo, 'progress.md'), 'utf8'), /integratie groen/);
    assert.equal(git(fixture.repo, 'status', '--porcelain'), '');
    assert.equal(git(fixture.repo, 'rev-list', '--left-right', '--count', 'HEAD...@{u}').replace('\t', ' '), '0 0');
  } finally {
    fs.rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test('deploy-behoefte stopt bij Bas en roept geen integratie- of deploypad aan', () => {
  const fixture = createFixture({ deploySentinel: true });
  try {
    const result = runRunner(fixture.repo, '--deploy-required');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const handoff = parseFrontmatter(fs.readFileSync(path.join(fixture.repo, 'handoff.md'), 'utf8'));
    assert.equal(handoff.state, 'BLOCKED');
    assert.equal(handoff.owner, 'bas');
    assert.equal(handoff.action_required_by, 'bas');
    assert.equal(fs.existsSync(path.join(fixture.repo, 'deploy-was-called')), false);
    assert.equal(integrationPlan().some((argv) => argv.some((part) => /deploy/i.test(part))), false);
    assert.equal(git(fixture.repo, 'status', '--porcelain'), '');
    assert.equal(git(fixture.repo, 'rev-list', '--left-right', '--count', 'HEAD...@{u}').replace('\t', ' '), '0 0');
  } finally {
    fs.rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test('geweigerde push faalt non-zero met een integere hervatbare baton', () => {
  const fixture = createFixture();
  try {
    git(fixture.repo, 'remote', 'set-url', '--push', 'origin', path.join(fixture.parent, 'ontbreekt.git'));
    const result = runRunner(fixture.repo);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /git push faalde/);
    const handoff = parseFrontmatter(fs.readFileSync(path.join(fixture.repo, 'handoff.md'), 'utf8'));
    assert.equal(handoff.state, 'INTEGRATION_IN_PROGRESS');
    assert.equal(handoff.owner, 'mistral');
    assert.equal(git(fixture.repo, 'status', '--porcelain'), '');
    assert.equal(
      fs.readdirSync(fixture.repo).some((name) => name.includes('.runner-') && name.endsWith('.tmp')),
      false,
    );
  } finally {
    fs.rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test('stdin boven 512 KiB wordt geweigerd voordat de repo wordt aangeraakt', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alv-integration-context-'));
  const repo = path.join(directory, 'repo');
  const contextFile = path.join(directory, 'oversized.context');
  fs.mkdirSync(repo);
  fs.writeFileSync(contextFile, Buffer.alloc(512 * 1024 + 1, 65));
  const contextHandle = fs.openSync(contextFile, 'r');
  try {
    const result = run(process.execPath, [RUNNER, '--stdin', '--repo', repo], {
      stdio: [contextHandle, 'pipe', 'pipe'],
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /stdin-context overschrijdt de runnerlimiet/);
    assert.deepEqual(fs.readdirSync(repo), []);
  } finally {
    fs.closeSync(contextHandle);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Git-sync-tellers accepteren tabs en willekeurige witruimte fail-closed', () => {
  assert.deepEqual(parseSyncCounts('0\t0\n'), [0, 0]);
  assert.deepEqual(parseSyncCounts('  12    3  '), [12, 3]);
  assert.throws(() => parseSyncCounts('0'), /geen twee geldige tellers/);
  assert.throws(() => parseSyncCounts('nul 0'), /geen twee geldige tellers/);
});

test('atomisch schrijven herprobeert tijdelijke Windows-locks en ruimt tempbestanden op', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alv-integration-atomic-'));
  const file = path.join(directory, 'handoff.md');
  fs.writeFileSync(file, 'oud\n');
  let attempts = 0;
  try {
    writeAtomic(file, 'nieuw\n', {
      renameFile(source, target) {
        attempts += 1;
        if (attempts < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' });
        fs.renameSync(source, target);
      },
      wait() {},
    });
    assert.equal(attempts, 3);
    assert.equal(fs.readFileSync(file, 'utf8'), 'nieuw\n');
    assert.equal(fs.readdirSync(directory).some((name) => name.includes('.runner-')), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('frontmatter- en progressuitvoer zijn deterministisch bij gelijke input', () => {
  const original = [
    '---',
    'sprint: 6',
    'state: READY_FOR_INTEGRATION',
    'owner: mistral',
    'since: 2026-08-13T07:00:00Z',
    'next: claude',
    'action_required_by: none',
    'blocked: false',
    'note: "start"',
    '---',
    '',
    '# Body',
    '',
  ].join('\n');
  const updates = { state: 'SPRINT_DONE', owner: 'claude', since: FIXED_NOW, note: 'klaar' };
  assert.equal(updateFrontmatter(original, updates), updateFrontmatter(original, updates));
  assert.equal(progressLine(FIXED_NOW, 'groen'), progressLine(FIXED_NOW, 'groen'));
});

test('twee volledige runs met dezelfde context en tijd leveren dezelfde bestanden', () => {
  const first = createFixture();
  const second = createFixture();
  try {
    const firstResult = runRunner(first.repo);
    const secondResult = runRunner(second.repo);
    assert.equal(firstResult.status, 0, firstResult.stderr || firstResult.stdout);
    assert.equal(secondResult.status, 0, secondResult.stderr || secondResult.stdout);
    assert.equal(
      fs.readFileSync(path.join(first.repo, 'handoff.md'), 'utf8'),
      fs.readFileSync(path.join(second.repo, 'handoff.md'), 'utf8'),
    );
    assert.equal(
      fs.readFileSync(path.join(first.repo, 'progress.md'), 'utf8'),
      fs.readFileSync(path.join(second.repo, 'progress.md'), 'utf8'),
    );
  } finally {
    fs.rmSync(first.parent, { recursive: true, force: true });
    fs.rmSync(second.parent, { recursive: true, force: true });
  }
});

test('voorbeeldconfig bevat alleen concrete lokale runners en geen Gemini-runner', () => {
  const config = fs.readFileSync(path.join(ROOT, 'mistral-lokaal', 'autorun.config.example.ps1'), 'utf8');
  assert.match(config, /ALV_AUTORUN_CODEX_ARGV\s*=/);
  assert.match(config, /ALV_AUTORUN_CLAUDE_ARGV\s*=/);
  assert.match(config, /ALV_AUTORUN_MISTRAL_ARGV\s*=/);
  assert.doesNotMatch(config, /ALV_AUTORUN_GEMINI_ARGV/);
  assert.match(config, /--ask-for-approval.*never/);
  assert.match(config, /--permission-mode.*dontAsk/);
  assert.match(config, /run_integration_turn\.mjs.*--stdin/);
});
