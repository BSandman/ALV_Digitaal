#!/usr/bin/env node

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

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
const seedSql = renderSql(dataset);
await writeFile(path.join(outputDir, '02-seed-synthetic.sql'), seedSql, 'utf8');
console.log(`[seed] Mistral-set geselecteerd: ${dataset.participants.length} fictieve deelnemers.`);

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Ongeldig argument bij positie ${index + 1}`);
    }
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
    if (!participant || typeof participant !== 'object') {
      throw new Error(`Deelnemer ${participantIndex + 1} is geen object.`);
    }
    const entitlementSources = participant.entitlements ?? participant.rights ?? participant.rechten;
    if (!Array.isArray(entitlementSources) || entitlementSources.length === 0) {
      throw new Error(`Deelnemer ${participantIndex + 1} bevat geen stemrechten.`);
    }
    return {
      displayName: textValue(
        participant.displayName ?? participant.display_name ?? participant.name ?? participant.naam,
        `participants[${participantIndex}].displayName`
      ),
      objectLabel: textValue(
        participant.objectLabel ?? participant.object_label ?? participant.object ?? participant.adres,
        `participants[${participantIndex}].objectLabel`
      ),
      entitlements: entitlementSources.map((entitlement, entitlementIndex) => ({
        splitsingCode: textValue(
          entitlement.splitsingCode ?? entitlement.splitsing_code ?? entitlement.code,
          `participants[${participantIndex}].entitlements[${entitlementIndex}].splitsingCode`
        ),
        weight: positiveDecimal(
          entitlement.weight ?? entitlement.stemgewicht ?? entitlement.breukdeel,
          `participants[${participantIndex}].entitlements[${entitlementIndex}].weight`
        ),
      })),
    };
  });

  return { meeting, participants };
}

function renderSql({ meeting, participants }) {
  const lines = [
    '-- AUTOMATISCH GEGENEREERD uit een lokale, synthetische Mistral-set.',
    '-- Bevat uitsluitend de velden die het productieschema gebruikt; identiteit is fictief.',
    "SET time_zone = '+00:00';",
    'START TRANSACTION;',
    'INSERT INTO meeting (vve_code, meeting_date, status, invite_version)',
    `VALUES (${sqlString(meeting.vveCode)}, ${sqlString(meeting.meetingDate)}, ${sqlString(meeting.status)}, ${meeting.inviteVersion});`,
    'SET @meeting_id = LAST_INSERT_ID();',
  ];

  for (const participant of participants) {
    lines.push(
      'INSERT INTO participant (meeting_id, display_name, object_label)',
      `VALUES (@meeting_id, ${sqlString(participant.displayName)}, ${sqlString(participant.objectLabel)});`,
      'SET @participant_id = LAST_INSERT_ID();',
      'INSERT INTO entitlement (participant_id, splitsing_code, weight) VALUES',
      participant.entitlements
        .map((entitlement) => `(@participant_id, ${sqlString(entitlement.splitsingCode)}, ${entitlement.weight})`)
        .join(',\n') + ';'
    );
  }

  lines.push('COMMIT;', '');
  return lines.join('\n');
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
  if (typeof value === 'string' && /^\d+\/\d+$/.test(value)) {
    const [numerator, denominator] = value.split('/').map(Number);
    if (denominator === 0) throw new Error(`${field} heeft een nul als noemer.`);
    value = numerator / denominator;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} moet een positief getal zijn.`);
  return parsed.toFixed(4);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
