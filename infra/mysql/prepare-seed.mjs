#!/usr/bin/env node

import { createHmac, scrypt as scryptCallback } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const options = parseArgs(process.argv.slice(2));
const schemaPath = required(options, 'schema');
const fallbackPath = required(options, 'fallback');
const mistralRoot = required(options, 'mistral-root');
const outputDir = required(options, 'output');
const datasetPath = path.join(mistralRoot, 'out', 'synthetic', 'owners.synthetic.json');

await mkdir(outputDir, { recursive: true });
await copyFile(schemaPath, path.join(outputDir, '01-schema.sql'));

if (!existsSync(datasetPath)) {
  await copyFile(fallbackPath, path.join(outputDir, '02-seed-synthetic.sql'));
  console.log('[seed] Mistral-set ontbreekt; fictieve mini-seed met 120 deelnemers geselecteerd.');
  process.exit(0);
}

const rawDataset = JSON.parse(await readFile(datasetPath, 'utf8'));
const dataset = normalizeDataset(rawDataset);
const pepper = options['auth-pepper'] ?? process.env.SEED_AUTH_PEPPER;
if (dataset.participants.some((participant) => participant.credential) && Buffer.byteLength(pepper ?? '') < 32) {
  throw new Error('SEED_AUTH_PEPPER/--auth-pepper moet minimaal 32 bytes zijn voor toegangscodes.');
}
await prepareCredentials(dataset, pepper);
const seedSql = renderSql(dataset);
await writeFile(path.join(outputDir, '02-seed-synthetic.sql'), seedSql, 'utf8');
console.log(`[seed] Mistral-set geselecteerd: ${dataset.participants.length} fictieve deelnemers.`);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Ongeldig argument bij positie ${index + 1}`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function required(values, key) {
  if (!values[key]) throw new Error(`Verplicht argument ontbreekt: --${key}`);
  return values[key];
}

function normalizeDataset(value) {
  const root = Array.isArray(value) ? { owners: value } : value;
  if (!root || typeof root !== 'object') throw new Error('De synthetische set moet een object of array zijn.');
  const meetingSource = root.meeting ?? root.vergadering ?? {};
  const participantSources = root.owners ?? root.participants ?? root.eigenaren;
  if (!Array.isArray(participantSources) || participantSources.length === 0) {
    throw new Error('De synthetische set bevat geen owners/participants/eigenaren.');
  }

  const meeting = {
    vveCode: textValue(meetingSource.vveCode ?? meetingSource.vve_code ?? 'VVE-TEST-MISTRAL', 'meeting.vveCode'),
    meetingDate: dateValue(meetingSource.meetingDate ?? meetingSource.meeting_date ?? '2026-09-01'),
    status: enumValue(meetingSource.status ?? 'draft', ['draft', 'open', 'closed', 'archived'], 'meeting.status'),
    inviteVersion: positiveInteger(meetingSource.inviteVersion ?? meetingSource.invite_version ?? 1, 'meeting.inviteVersion'),
  };

  const participants = participantSources.map((participant, participantIndex) => {
    if (!participant || typeof participant !== 'object') throw new Error(`Deelnemer ${participantIndex + 1} is geen object.`);
    const entitlementSources = participant.entitlements ?? participant.rights ?? participant.rechten;
    if (!Array.isArray(entitlementSources) || entitlementSources.length === 0) {
      throw new Error(`Deelnemer ${participantIndex + 1} bevat geen stemrechten.`);
    }
    const credentialSource = participant.credential ?? participant.toegangscode;
    return {
      displayName: textValue(participant.displayName ?? participant.display_name ?? participant.name ?? participant.naam,
        `participants[${participantIndex}].displayName`),
      objectLabel: textValue(participant.objectLabel ?? participant.object_label ?? participant.object ?? participant.adres,
        `participants[${participantIndex}].objectLabel`),
      attendance: Boolean(participant.attendance?.present ?? participant.present ?? false),
      credential: credentialSource ? textValue(
        credentialSource.plaintext_code ?? credentialSource.plaintextCode ?? credentialSource.code ?? credentialSource,
        `participants[${participantIndex}].credential.plaintext_code`
      ) : null,
      entitlements: entitlementSources.map((entitlement, entitlementIndex) => ({
        splitsingCode: textValue(entitlement.splitsingCode ?? entitlement.splitsing_code ?? entitlement.code,
          `participants[${participantIndex}].entitlements[${entitlementIndex}].splitsingCode`),
        weight: positiveDecimal(entitlement.weight ?? entitlement.stemgewicht ?? entitlement.breukdeel,
          `participants[${participantIndex}].entitlements[${entitlementIndex}].weight`),
        powerStatus: powerStatus(entitlement.power_of_attorney ?? entitlement.powerOfAttorney ?? entitlement.machtiging),
      })),
    };
  });

  validateSplitTotals(participants, root.split_totals ?? root.splitTotals);
  return { meeting, participants };
}

async function prepareCredentials(dataset, pepper) {
  for (const participant of dataset.participants) {
    if (!participant.credential) continue;
    const code = participant.credential;
    const separator = code.indexOf('-');
    const locator = separator > 0 ? code.slice(0, separator) : '';
    if (!/^[A-Za-z0-9]{1,32}$/.test(locator)) throw new Error('Ongeldige toegangscodevorm in dataset.');
    const lookup = createHmac('sha256', pepper).update(`credential\0${locator}`).digest();
    const salt = createHmac('sha256', pepper).update(`seed-credential-salt\0${code}`).digest().subarray(0, 16);
    const derived = Buffer.from(await scrypt(code, salt, 32));
    participant.preparedCredential = {
      lookupHex: lookup.toString('hex'),
      hashHex: Buffer.from(`scrypt-v1$${salt.toString('base64url')}$${derived.toString('base64url')}`).toString('hex'),
    };
  }
}

function renderSql({ meeting, participants }) {
  const lines = [
    '-- AUTOMATISCH GEGENEREERD uit een lokale dataset.',
    '-- Leesbare toegangscodes zijn gehasht en komen niet in deze SQL terecht.',
    "SET time_zone = '+00:00';", 'START TRANSACTION;',
    'INSERT INTO meeting (vve_code, meeting_date, status, invite_version)',
    `VALUES (${sqlString(meeting.vveCode)}, ${sqlString(meeting.meetingDate)}, ${sqlString(meeting.status)}, ${meeting.inviteVersion});`,
    'SET @meeting_id = LAST_INSERT_ID();',
  ];

  for (const participant of participants) {
    lines.push(
      'INSERT INTO participant (meeting_id, display_name, object_label)',
      `VALUES (@meeting_id, ${sqlString(participant.displayName)}, ${sqlString(participant.objectLabel)});`,
      'SET @participant_id = LAST_INSERT_ID();',
      'INSERT INTO attendance (meeting_id, participant_id, present)',
      `VALUES (@meeting_id, @participant_id, ${participant.attendance ? 1 : 0});`
    );
    if (participant.preparedCredential) {
      lines.push(
        'INSERT INTO credential (participant_id, meeting_id, invite_version, code_lookup_hash, code_hash)',
        `VALUES (@participant_id, @meeting_id, ${meeting.inviteVersion}, UNHEX('${participant.preparedCredential.lookupHex}'), UNHEX('${participant.preparedCredential.hashHex}'));`
      );
    }
    for (const entitlement of participant.entitlements) {
      lines.push(
        'INSERT INTO entitlement (participant_id, splitsing_code, weight)',
        `VALUES (@participant_id, ${sqlString(entitlement.splitsingCode)}, ${entitlement.weight});`,
        'SET @entitlement_id = LAST_INSERT_ID();'
      );
      if (entitlement.powerStatus) {
        lines.push(
          'INSERT INTO power_of_attorney (meeting_id, entitlement_id, status)',
          `VALUES (@meeting_id, @entitlement_id, ${sqlString(entitlement.powerStatus)});`
        );
      }
    }
  }
  lines.push('COMMIT;', '');
  return lines.join('\n');
}

function validateSplitTotals(participants, expected) {
  if (!expected) return;
  const actual = new Map();
  for (const participant of participants) for (const entitlement of participant.entitlements) {
    actual.set(entitlement.splitsingCode, (actual.get(entitlement.splitsingCode) ?? 0n) + decimalUnits(entitlement.weight));
  }
  for (const [code, value] of Object.entries(expected)) {
    if ((actual.get(code) ?? 0n) !== decimalUnits(positiveDecimal(value, `split_totals.${code}`))) {
      throw new Error(`Gewichten voor splitsing ${code} tellen niet exact op tot split_totals.${code}.`);
    }
  }
}

function textValue(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} moet niet-lege tekst zijn.`);
  if (value.length > 500) throw new Error(`${field} is te lang.`);
  return value.trim();
}

function dateValue(value) {
  const date = textValue(value, 'meeting.meetingDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('meeting.meetingDate moet YYYY-MM-DD zijn.');
  return date;
}

function enumValue(value, allowed, field) {
  if (!allowed.includes(value)) throw new Error(`${field} heeft een ongeldige waarde.`);
  return value;
}

function positiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${field} moet een positief geheel getal zijn.`);
  return parsed;
}

function positiveDecimal(value, field) {
  const text = String(value);
  if (/^\d+\/\d+$/.test(text)) {
    const [numerator, denominator] = text.split('/').map(BigInt);
    if (numerator <= 0n || denominator <= 0n || numerator * 10_000n % denominator !== 0n) {
      throw new Error(`${field} moet exact op vier decimalen passen.`);
    }
    return formatUnits(numerator * 10_000n / denominator);
  }
  const match = text.match(/^(\d+)(?:\.(\d{1,4}))?$/);
  if (!match) throw new Error(`${field} moet een positief getal met maximaal vier decimalen zijn.`);
  const normalized = `${match[1]}.${(match[2] ?? '').padEnd(4, '0')}`;
  if (decimalUnits(normalized) <= 0n) throw new Error(`${field} moet positief zijn.`);
  return normalized;
}

function decimalUnits(value) {
  const [whole, fraction] = String(value).split('.');
  return BigInt(whole) * 10_000n + BigInt((fraction ?? '').padEnd(4, '0'));
}

function formatUnits(value) {
  const text = value.toString().padStart(5, '0');
  return `${text.slice(0, -4)}.${text.slice(-4)}`;
}

function powerStatus(value) {
  if (!value) return null;
  const status = typeof value === 'object' ? value.status : value;
  return enumValue(status ?? 'active', ['active', 'invalidated_owner_login'], 'power_of_attorney.status');
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
