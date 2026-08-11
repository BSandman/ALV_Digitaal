#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mistralRoot = path.resolve(scriptDir, '..');
const options = parseArgs(process.argv.slice(2));
const seed = integer(options.seed ?? '20260811', '--seed');
const count = integer(options.count ?? '12', '--count');
if (count < 6 || count > 200) throw new Error('--count moet tussen 6 en 200 liggen.');

const output = path.resolve(options.output ?? path.join(mistralRoot, 'out', 'synthetic', 'owners.synthetic.json'));
const endpoint = options.endpoint ?? 'http://localhost:11434';
assertLoopback(endpoint);

const fallbackNames = Array.from({ length: count }, (_, index) => `Fictieve Eigenaar ${String(index + 1).padStart(3, '0')}`);
const names = options.offline
  ? fallbackNames
  : await ollamaNames({ endpoint, model: options.model ?? 'mistral-nemo:latest', seed, count }).catch((error) => {
      console.warn(`[C1] Ollama niet beschikbaar (${error.message}); deterministische offline-namen gebruikt.`);
      return fallbackNames;
    });

const dataset = buildDataset(seed, count, names);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
console.log(`[C1] ${dataset.participants.length} volledig fictieve deelnemers geschreven naar ${output}`);

function buildDataset(datasetSeed, participantCount, displayNames) {
  const random = mulberry32(datasetSeed);
  const splitMembers = {
    PG: Array.from({ length: participantCount }, (_, index) => index),
    TF: Array.from({ length: participantCount }, (_, index) => index).filter((index) => index % 2 === 0),
    NB: Array.from({ length: participantCount }, (_, index) => index).filter((index) => index % 2 === 1),
  };
  const weights = Object.fromEntries(Object.entries(splitMembers).map(([code, members]) => [
    code,
    distributeExact(members, random),
  ]));

  const participants = Array.from({ length: participantCount }, (_, index) => {
    const participantRef = `participant-${String(index + 1).padStart(3, '0')}`;
    const splitCodes = ['PG', index % 2 === 0 ? 'TF' : 'NB'];
    const entitlements = splitCodes.map((splitsingCode) => ({
      ref: `${participantRef}-${splitsingCode.toLowerCase()}`,
      splitsing_code: splitsingCode,
      weight: formatScaled(weights[splitsingCode].get(index)),
    }));

    if (index === 0) entitlements[0].power_of_attorney = { status: 'active' };
    if (index === 1) entitlements[0].power_of_attorney = { status: 'active' };
    if (index === 4) entitlements[1].power_of_attorney = { status: 'active' };

    return {
      ref: participantRef,
      display_name: displayNames[index] ?? fallbackNames[index],
      object_label: `Fictief testobject ${String(index + 1).padStart(3, '0')}`,
      attendance: { present: index === 0 || index === 3 || index >= 6 },
      credential: { plaintext_code: deterministicCode(datasetSeed, index) },
      entitlements,
    };
  });

  return {
    schema_version: 1,
    classification: 'synthetic',
    seed: datasetSeed,
    meeting: {
      vve_code: `VVE-FICTIEF-${String(Math.abs(datasetSeed)).padStart(6, '0').slice(-6)}`,
      meeting_date: '2026-09-01',
      status: 'draft',
      invite_version: 1,
    },
    split_totals: { PG: '10000.0000', TF: '10000.0000', NB: '10000.0000' },
    participants,
    scenarios: {
      multi_vve_patterns: ['PG+TF', 'PG+NB'],
      overlapping_attendance_and_power_ref: participants[0].entitlements[0].ref,
      power_only_entitlement_ref: participants[1].entitlements[0].ref,
      absent_entitlement_ref: participants[2].entitlements[0].ref,
      non_voter_entitlement_refs: [participants[0].entitlements[1].ref, participants[1].entitlements[0].ref],
    },
  };
}

function distributeExact(memberIndexes, random) {
  const total = 100_000_000n;
  const raw = memberIndexes.map(() => BigInt(1000 + Math.floor(random() * 9001)));
  const rawTotal = raw.reduce((sum, value) => sum + value, 0n);
  const assigned = raw.map((value) => total * value / rawTotal);
  let remainder = total - assigned.reduce((sum, value) => sum + value, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % assigned.length) {
    assigned[index] += 1n;
    remainder -= 1n;
  }
  return new Map(memberIndexes.map((member, index) => [member, assigned[index]]));
}

function formatScaled(value) {
  const text = value.toString().padStart(5, '0');
  return `${text.slice(0, -4)}.${text.slice(-4)}`;
}

function deterministicCode(datasetSeed, index) {
  const secret = createHash('sha256').update(`C1\0${datasetSeed}\0${index}`).digest('base64url').slice(0, 22);
  return `T${String(index + 1).padStart(3, '0')}-${secret}`;
}

async function ollamaNames({ endpoint: base, model, seed: modelSeed, count: requested }) {
  for (const candidate of [...new Set([model, 'mistral'])]) {
    const response = await fetch(new URL('/api/generate', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: candidate,
        stream: false,
        format: 'json',
        prompt: `Geef exact ${requested} duidelijk fictieve Nederlandse eigenaarsnamen als JSON: {"names":[...]}. Geen adressen, e-mailadressen of andere persoonsgegevens.`,
        options: { temperature: 0, seed: modelSeed },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) continue;
    const body = await response.json();
    const parsed = JSON.parse(body.response);
    if (Array.isArray(parsed.names) && parsed.names.length === requested
      && parsed.names.every((name) => typeof name === 'string' && name.trim() && name.length <= 100)) {
      return parsed.names.map((name) => `Fictief — ${name.trim()}`);
    }
  }
  throw new Error('geen bruikbare respons van mistral-nemo of mistral');
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith('--')) throw new Error(`Ongeldig argument: ${key}`);
    if (key === '--offline') parsed.offline = true;
    else {
      if (args[index + 1] === undefined) throw new Error(`Waarde ontbreekt voor ${key}`);
      parsed[key.slice(2)] = args[++index];
    }
  }
  return parsed;
}

function integer(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} moet een geheel getal zijn.`);
  return parsed;
}

function assertLoopback(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Ollama-endpoint moet lokale HTTP-loopback zijn.');
  }
}

function mulberry32(seedValue) {
  let state = seedValue >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
