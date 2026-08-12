#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const READY = 'READY_FOR_INTEGRATION';
const IN_PROGRESS = 'INTEGRATION_IN_PROGRESS';
const MAX_CONTEXT_BYTES = 512 * 1024;

export function integrationPlan(platform = process.platform) {
  const npm = platform === 'win32'
    ? [process.env.ComSpec || 'cmd.exe', '/d', '/s', '/c', 'npm.cmd run check --prefix app']
    : ['npm', 'run', 'check', '--prefix', 'app'];
  return [
    ['python', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'],
    npm,
    [
      'node',
      'mistral-lokaal/scripts/pii_scan',
      '--diff-base',
      'origin/main',
      '--fixtures',
      'tests/fixtures',
      '--artifact',
      'dist',
    ],
  ];
}

export function parseFrontmatter(text) {
  const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('handoff.md heeft geen geldige frontmatter');
  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error(`ongeldige frontmatterregel: ${line}`);
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

export function updateFrontmatter(text, updates) {
  const values = { ...parseFrontmatter(text), ...updates };
  const required = [
    'sprint',
    'state',
    'owner',
    'since',
    'next',
    'action_required_by',
    'blocked',
    'note',
  ];
  for (const key of required) {
    if (values[key] === undefined) throw new Error(`frontmatterveld ontbreekt: ${key}`);
  }
  const safeNote = String(values.note).replaceAll('"', "'").replace(/[\r\n]+/g, ' ');
  const closing = text.replace(/^\uFEFF/, '').match(/^---\r?\n[\s\S]*?\r?\n---/);
  const body = text.replace(/^\uFEFF/, '').slice(closing[0].length);
  return [
    '---',
    `sprint: ${values.sprint}`,
    `state: ${values.state}`,
    `owner: ${values.owner}`,
    `since: ${values.since}`,
    `next: ${values.next}`,
    `action_required_by: ${values.action_required_by}`,
    `blocked: ${values.blocked}`,
    `note: "${safeNote}"`,
    '---',
  ].join('\n') + body.replace(/^\r?\n?/, '\n');
}

export function progressLine(now, outcome) {
  return `- ${now.slice(0, 10)} · Mistral · **Sprint 6 integratie ${outcome}.**`;
}

function parseArgs(argv) {
  const options = { stdin: false, repo: process.cwd(), now: null, deployRequired: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--stdin') options.stdin = true;
    else if (argument === '--deploy-required') options.deployRequired = true;
    else if (argument === '--repo' || argument === '--now') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} vereist een waarde`);
      options[argument === '--repo' ? 'repo' : 'now'] = value;
      index += 1;
    } else if (argument === '--help') options.help = true;
    else throw new Error(`onbekend argument: ${argument}`);
  }
  return options;
}

function run(repo, argv, { capture = false } = {}) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: repo,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `: ${(result.stderr || result.stdout || '').trim()}` : '';
    throw new Error(`${argv.join(' ')} faalde met exitcode ${result.status}${detail}`);
  }
  return result;
}

function git(repo, ...args) {
  return run(repo, ['git', ...args], { capture: true }).stdout.trim();
}

function ensureCleanAndSynced(repo) {
  if (git(repo, 'status', '--porcelain')) throw new Error('working tree is niet schoon');
  const counts = git(repo, 'rev-list', '--left-right', '--count', 'HEAD...@{u}')
    .replaceAll('\t', ' ')
    .split(/\s+/);
  if (counts.join(' ') !== '0 0') throw new Error('lokale branch en upstream zijn niet in sync');
}

function writeAtomic(file, content) {
  const temp = `${file}.runner-${process.pid}.tmp`;
  fs.writeFileSync(temp, content, 'utf8');
  fs.renameSync(temp, file);
}

function updateHandoff(repo, now, updates) {
  const file = path.join(repo, 'handoff.md');
  writeAtomic(file, updateFrontmatter(fs.readFileSync(file, 'utf8'), { since: now, ...updates }));
}

function appendProgress(repo, line) {
  const file = path.join(repo, 'progress.md');
  const current = fs.readFileSync(file, 'utf8');
  writeAtomic(file, `${current.replace(/[\r\n]*$/, '')}\n\n${line}\n`);
}

function commitAndPush(repo, message, files) {
  git(repo, 'add', '--', ...files);
  git(repo, 'commit', '-m', message, '--', ...files);
  git(repo, 'push');
  ensureCleanAndSynced(repo);
}

function readBoundedStdin() {
  const context = fs.readFileSync(0);
  if (context.length === 0) throw new Error('begrensde context ontbreekt op stdin');
  if (context.length > MAX_CONTEXT_BYTES) throw new Error('stdin-context overschrijdt de runnerlimiet');
  return context.toString('utf8');
}

export function execute(options) {
  const repo = path.resolve(options.repo);
  const now = options.now ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (Number.isNaN(Date.parse(now))) throw new Error('--now moet een geldige ISO-tijd zijn');
  ensureCleanAndSynced(repo);

  const handoffFile = path.join(repo, 'handoff.md');
  let handoff = parseFrontmatter(fs.readFileSync(handoffFile, 'utf8'));
  if (handoff.owner !== 'mistral' || ![READY, IN_PROGRESS].includes(handoff.state)) {
    throw new Error('baton staat niet op een hervatbare Mistral-integratiebeurt');
  }

  if (handoff.state === READY) {
    updateHandoff(repo, now, {
      state: IN_PROGRESS,
      owner: 'mistral',
      next: 'claude',
      action_required_by: 'none',
      blocked: 'false',
      note: 'Mistral voert de vaste integratiecontroles uit; deploy blijft uit.',
    });
    commitAndPush(repo, 'chore: claim integration turn', ['handoff.md']);
  }

  if (options.deployRequired) {
    appendProgress(repo, progressLine(now, 'gepauzeerd: menselijke deploy-go vereist; niets gedeployed'));
    updateHandoff(repo, now, {
      state: 'BLOCKED',
      owner: 'bas',
      next: 'mistral',
      action_required_by: 'bas',
      blocked: 'true',
      note: 'Menselijke deploy-go vereist; de integratierunner heeft niet gedeployed.',
    });
    commitAndPush(repo, 'chore: request human deploy approval', ['handoff.md', 'progress.md']);
    return;
  }

  for (const command of integrationPlan()) run(repo, command);

  appendProgress(repo, progressLine(now, 'groen: Python-, app-, architectuur-, release- en PII-gates geslaagd; niet gedeployed'));
  updateHandoff(repo, now, {
    state: 'SPRINT_DONE',
    owner: 'claude',
    next: 'bas',
    action_required_by: 'none',
    blocked: 'false',
    note: 'Deterministische integratie is groen en gepusht; er is niet gedeployed.',
  });
  commitAndPush(repo, 'chore: complete deterministic integration', ['handoff.md', 'progress.md']);
}

function printHelp() {
  process.stdout.write(
    'Gebruik: node mistral-lokaal/scripts/run_integration_turn.mjs --stdin [--repo PAD] [--deploy-required]\n',
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();
  if (!options.stdin) throw new Error('--stdin is verplicht');
  readBoundedStdin();
  execute(options);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`Integratierunner gestopt: ${error.message}\n`);
    process.exitCode = 1;
  });
}
