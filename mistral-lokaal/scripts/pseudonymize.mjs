#!/usr/bin/env node

import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mistralRoot = path.resolve(scriptDir, '..');
const options = parseArgs(process.argv.slice(2));
const secureRoot = path.resolve(options['secure-root'] ?? path.join(mistralRoot, 'secure'));
const inputPath = securePath(options.input ?? path.join(secureRoot, 'owners.real.json'), 'invoer');
const mappingPath = securePath(options.mapping ?? path.join(secureRoot, 'pseudonym-map.json'), 'mapping');
const keyPath = securePath(options.key ?? path.join(secureRoot, 'pseudonym.key'), 'sleutel');
const outputPath = path.resolve(options.output ?? path.join(mistralRoot, 'out', 'pseudo', 'owners.pseudo.json'));
const endpoint = options.endpoint ?? 'http://localhost:11434';
assertLoopback(endpoint);

if (!existsSync(inputPath)) throw new Error(`C2-invoer ontbreekt: ${inputPath}`);
await mkdir(secureRoot, { recursive: true });
await assertResolvedInside(inputPath, 'invoer');
if (existsSync(mappingPath)) await assertResolvedInside(mappingPath, 'mapping');
if (existsSync(keyPath)) await assertResolvedInside(keyPath, 'sleutel');
const key = await loadOrCreateKey(keyPath);
const mapping = await loadMapping(mappingPath);
const source = JSON.parse(await readFile(inputPath, 'utf8'));
const participantSources = source.participants ?? source.owners ?? source.eigenaren;
if (!Array.isArray(participantSources) || participantSources.length === 0) {
  throw new Error('C2-invoer bevat geen participants/owners/eigenaren.');
}

const pending = [];
for (const [index, participant] of participantSources.entries()) {
  const sourceKey = identityKey(participant, index);
  if (!mapping.owners[sourceKey]) pending.push({ sourceKey, index });
}

let modelNames = [];
if (options['use-ollama'] && pending.length > 0) {
  modelNames = await ollamaNames({ endpoint, model: options.model ?? 'mistral-nemo:latest', count: pending.length })
    .catch((error) => {
      console.warn(`[C2] Ollama niet beschikbaar (${error.message}); lokale pseudoniemen gebruikt.`);
      return [];
    });
}

for (const [pendingIndex, item] of pending.entries()) {
  const token = keyedHex(key, `owner\0${item.sourceKey}`).slice(0, 12);
  mapping.owners[item.sourceKey] = {
    pseudonym: modelNames[pendingIndex] ? `Pseudoniem — ${modelNames[pendingIndex]}` : `Pseudonieme Eigenaar ${token.toUpperCase()}`,
    object_label: `Pseudoniem object ${token.slice(0, 8).toUpperCase()}`,
  };
}

const entitlementRefMap = new Map();
const participants = participantSources.map((participant, index) => {
  const sourceKey = identityKey(participant, index);
  const mapped = mapping.owners[sourceKey];
  const entitlements = participant.entitlements ?? participant.rights ?? participant.rechten;
  if (!Array.isArray(entitlements) || entitlements.length === 0) {
    throw new Error(`Deelnemer ${index + 1} bevat geen stemrechten.`);
  }
  return {
    ref: `participant-${keyedHex(key, `ref\0${sourceKey}`).slice(0, 12)}`,
    display_name: mapped.pseudonym,
    object_label: mapped.object_label,
    attendance: { present: booleanValue(participant.attendance?.present ?? participant.present ?? false, `participant[${index}].present`) },
    credential: { plaintext_code: pseudoCode(key, sourceKey, index) },
    entitlements: entitlements.map((entitlement, entitlementIndex) => {
      const pseudoRef = `entitlement-${keyedHex(key, `entitlement\0${sourceKey}\0${entitlementIndex}`).slice(0, 12)}`;
      const sourceRef = entitlement.ref ?? entitlement.id;
      if (sourceRef !== undefined) entitlementRefMap.set(String(sourceRef), pseudoRef);
      const normalized = {
        ref: pseudoRef,
        splitsing_code: requiredText(entitlement.splitsing_code ?? entitlement.splitsingCode ?? entitlement.code, 'splitsing_code'),
        weight: exactDecimal(entitlement.weight ?? entitlement.stemgewicht ?? entitlement.breukdeel),
      };
      const power = entitlement.power_of_attorney ?? entitlement.powerOfAttorney ?? entitlement.machtiging;
      if (power) normalized.power_of_attorney = { status: normalizePower(power.status ?? power) };
      return normalized;
    }),
  };
});

const meetingSource = source.meeting ?? source.vergadering ?? {};
const result = {
  schema_version: 1,
  classification: 'pseudonymized',
  meeting: {
    vve_code: `VVE-PSEUDO-${keyedHex(key, String(meetingSource.vve_code ?? meetingSource.vveCode ?? 'meeting')).slice(0, 8).toUpperCase()}`,
    meeting_date: requiredText(meetingSource.meeting_date ?? meetingSource.meetingDate ?? '2026-09-01', 'meeting_date'),
    status: meetingSource.status ?? 'draft',
    invite_version: meetingSource.invite_version ?? meetingSource.inviteVersion ?? 1,
  },
  ...(source.split_totals ? { split_totals: normalizeTotals(source.split_totals) } : {}),
  participants,
  ...(source.scenarios ? { scenarios: remapScenarios(source.scenarios, entitlementRefMap) } : {}),
};

await mkdir(path.dirname(mappingPath), { recursive: true });
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(`[C2] ${participants.length} deelnemers gepseudonimiseerd; mapping en sleutel blijven in ${secureRoot}`);

function securePath(candidate, label) {
  const resolved = path.resolve(candidate);
  const relative = path.relative(secureRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`C2-${label} moet binnen de secure-map staan.`);
  }
  return resolved;
}

async function loadOrCreateKey(file) {
  if (existsSync(file)) {
    const value = (await readFile(file, 'utf8')).trim();
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.length !== 32) throw new Error('C2-sleutel moet 32 bytes base64url zijn.');
    return decoded;
  }
  const generated = randomBytes(32);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${generated.toString('base64url')}\n`, { encoding: 'utf8', mode: 0o600 });
  return generated;
}

async function assertResolvedInside(file, label) {
  const [realRoot, realFile] = await Promise.all([realpath(secureRoot), realpath(file)]);
  const relative = path.relative(realRoot, realFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`C2-${label} verwijst via een koppeling buiten de secure-map.`);
  }
}

async function loadMapping(file) {
  if (!existsSync(file)) return { version: 1, owners: {} };
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (value?.version !== 1 || !value.owners || typeof value.owners !== 'object') {
    throw new Error('Ongeldige C2-mapping.');
  }
  return value;
}

function identityKey(participant, index) {
  const value = participant.source_key ?? participant.sourceKey ?? participant.id
    ?? participant.email ?? participant.display_name ?? participant.displayName ?? participant.name ?? participant.naam;
  return requiredText(value ?? `row-${index + 1}`, `participant[${index}].identity`);
}

function exactDecimal(value) {
  const text = String(value);
  if (/^\d+\/\d+$/.test(text)) {
    const [numerator, denominator] = text.split('/').map(BigInt);
    if (numerator <= 0n || denominator <= 0n || numerator * 10_000n % denominator !== 0n) {
      throw new Error(`Ongeldig of niet exact gewicht: ${text}`);
    }
    const scaled = (numerator * 10_000n / denominator).toString().padStart(5, '0');
    return `${scaled.slice(0, -4)}.${scaled.slice(-4)}`;
  }
  const match = text.match(/^(\d+)(?:\.(\d{1,4}))?$/);
  if (!match || BigInt(match[1]) === 0n && !/[1-9]/.test(match[2] ?? '')) throw new Error(`Ongeldig positief gewicht: ${text}`);
  return `${match[1]}.${(match[2] ?? '').padEnd(4, '0')}`;
}

function normalizeTotals(totals) {
  return Object.fromEntries(Object.entries(totals).map(([code, value]) => [code, exactDecimal(value)]));
}

function normalizePower(value) {
  return value === 'invalidated_owner_login' ? value : 'active';
}

function remapScenarios(scenarios, refMap) {
  const result = {};
  if (Array.isArray(scenarios.multi_vve_patterns)) result.multi_vve_patterns = [...scenarios.multi_vve_patterns];
  for (const field of ['overlapping_attendance_and_power_ref', 'power_only_entitlement_ref', 'absent_entitlement_ref']) {
    if (scenarios[field] !== undefined && refMap.has(String(scenarios[field]))) result[field] = refMap.get(String(scenarios[field]));
  }
  if (Array.isArray(scenarios.non_voter_entitlement_refs)) {
    result.non_voter_entitlement_refs = scenarios.non_voter_entitlement_refs
      .filter((ref) => refMap.has(String(ref))).map((ref) => refMap.get(String(ref)));
  }
  return result;
}

function pseudoCode(keyValue, sourceKey, index) {
  return `A${String(index + 1).padStart(3, '0')}-${createHmac('sha256', keyValue).update(`credential\0${sourceKey}`).digest('base64url').slice(0, 22)}`;
}

function keyedHex(keyValue, value) {
  return createHmac('sha256', keyValue).update(value).digest('hex');
}

async function ollamaNames({ endpoint: base, model, count }) {
  for (const candidate of [...new Set([model, 'mistral'])]) {
    const response = await fetch(new URL('/api/generate', base), {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model: candidate, stream: false, format: 'json', options: { temperature: 0, seed: 20260811 },
        prompt: `Geef exact ${count} verzonnen Nederlandse namen als JSON {"names":[...]}; geen adressen of e-mails.` }),
    });
    if (!response.ok) continue;
    const parsed = JSON.parse((await response.json()).response);
    if (Array.isArray(parsed.names) && parsed.names.length === count) return parsed.names.map((name) => requiredText(name, 'naam'));
  }
  throw new Error('geen bruikbare lokale modelrespons');
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error(`${field} moet niet-lege tekst zijn.`);
  return value.trim();
}

function booleanValue(value, field) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  throw new Error(`${field} moet een boolean zijn.`);
}

function assertLoopback(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Ollama-endpoint moet lokale HTTP-loopback zijn.');
  }
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key?.startsWith('--')) throw new Error(`Ongeldig argument: ${key}`);
    if (key === '--use-ollama') parsed['use-ollama'] = true;
    else {
      if (args[index + 1] === undefined) throw new Error(`Waarde ontbreekt voor ${key}`);
      parsed[key.slice(2)] = args[++index];
    }
  }
  return parsed;
}
